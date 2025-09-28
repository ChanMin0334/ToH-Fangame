// /functions/stockmarket.js (수정)
module.exports = (admin, { onCall, HttpsError, logger, onSchedule /*, GEMINI_API_KEY*/ }) => {
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  // ---------- helpers ----------
  const nowISO = () => new Date().toISOString();
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  
  // [수정] 이벤트 기반 가격 변동 로직 (무작위성 추가)
  const applyEventToPrice = (cur, dir, mag) => {
    // 기본 변동률에 ±20%의 무작위성을 추가합니다.
    const randomFactor = 1 + (Math.random() - 0.5) * 0.4; // 0.8 ~ 1.2
    const rateBase = { small: 0.03, medium: 0.08, large: 0.15 }[mag] ?? 0.05;
    const finalRate = rateBase * randomFactor;

    const rate = dir === 'up' ? finalRate : dir === 'down' ? -finalRate : 0;
    return Math.max(1, Math.round(cur * (1 + rate)));
  };

  // [수정] 거래량 기반 가격 변동 로직 (변동폭 제한 제거)
  const applyTradeToPrice = (currentPrice, quantity, isBuy) => {
      // 거래량 100주당 0.1% 변동을 기본으로 설정
      const baseRate = 0.001; 
      const changeRate = baseRate * (quantity / 100);
      const multiplier = isBuy ? (1 + changeRate) : (1 - changeRate);
      
      // 가격 변동폭 제한 로직을 제거하여 시장 충격을 그대로 반영합니다.
      // const finalMultiplier = clamp(multiplier, 0.95, 1.05);
      
      return Math.max(1, Math.round(currentPrice * multiplier));
  };
  
  const ensureListed = (s) => {
    if (!s || s.status !== 'listed') throw new HttpsError('failed-precondition', '상장 상태가 아닙니다.');
  };

  // ---------- 5분 스케줄러: ①이벤트결정 → ②뉴스생성/발송 → ③가격반영 ----------
  const updateStockMarket = onSchedule({
    schedule: 'every 5 minutes', // [수정] 10분 -> 5분
    timeZone: 'Asia/Seoul',
    region: 'us-central1',
  }, async () => {
    const stocksSnap = await db.collection('stocks').get();
    for (const doc of stocksSnap.docs) {
      const stock = doc.data();
      const stockId = doc.id;
      // [신규] 이벤트 문서를 별도 컬렉션에서 관리
      const eventRef = db.collection('stock_events').doc(stockId);
      const eventSnap = await eventRef.get();
      const upcomingEvent = eventSnap.exists ? eventSnap.data() : null;

      const name = stock.name || 'UNNAMED';
      const subscribers = Array.isArray(stock.subscribers) ? stock.subscribers : [];
      const price = Number(stock.current_price || 100);
      const ph = Array.isArray(stock.price_history) ? stock.price_history : [];

      // 1단계: 다음 이벤트 비공개 결정
      if (!upcomingEvent) {
        const directions = ['up', 'down', 'stable'];
        const magnitudes = ['small', 'medium', 'large'];
        const nextEvent = {
          change_direction: directions[Math.floor(Math.random()*directions.length)],
          magnitude: magnitudes[Math.floor(Math.random()*magnitudes.length)],
          news_generated: false,
        };
        await eventRef.set(nextEvent); // [수정] 별도 컬렉션에 저장
        continue;
      }

      // 2단계: 뉴스 생성/발송
      if (upcomingEvent && !upcomingEvent.news_generated) {
        const aiNews = {
          title: `[속보] ${name}에 이상 징후`,
          body: `${name} 종목에 의미 있는 변화 신호가 포착되었습니다. (예정: ${upcomingEvent.change_direction}/${upcomingEvent.magnitude})`,
        };
        // ... (메일 발송 로직은 기존과 동일)
        const tasks = subscribers.map(uid => {
          const mailRef = db.collection('mail').doc(uid).collection('msgs').doc();
          return mailRef.set({
            kind: 'etc',
            title: `[주식 속보] ${name}`,
            body: `${aiNews.title}\n\n${aiNews.body}`,
            sentAt: FieldValue.serverTimestamp(),
            from: '증권 정보국',
            read: false,
            attachments: { ref_type: 'stock', ref_id: doc.id },
          });
        });
        await Promise.all(tasks);
        await eventRef.update({ news_generated: true }); // [수정] 이벤트 문서 업데이트
        continue;
      }

      // 3단계: 실제 가격 반영
      if (upcomingEvent && upcomingEvent.news_generated) {
        const dir = upcomingEvent.change_direction || 'stable';
        const mag = upcomingEvent.magnitude || 'small';
        const next = applyEventToPrice(price, dir, mag);

        const history = ph.slice(-719);
        history.push({ date: nowISO(), price: next });

        await doc.ref.update({
          current_price: next,
          price_history: history,
        });
        await eventRef.delete(); // [수정] 사용된 이벤트 삭제
      }
    }
    logger.info('Stock market cycle done.');
  });

  // ---------- onCall: 매수 ----------
  const buyStock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const stockId = String(req.data?.stockId || '').trim();
    const quantity = Math.floor(Number(req.data?.quantity || 0));
    if (!stockId || quantity <= 0) throw new HttpsError('invalid-argument', 'stockId/quantity가 올바르지 않습니다.');

    return await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const stockRef = db.collection('stocks').doc(stockId);
      const portRef = db.doc(`users/${uid}/portfolio/${stockId}`);

      const [userSnap, stockSnap, portSnap] = await Promise.all([tx.get(userRef), tx.get(stockRef), tx.get(portRef)]);
      if (!stockSnap.exists) throw new HttpsError('not-found', '해당 종목이 없습니다.');
      const stock = stockSnap.data();
      ensureListed(stock);

      const price = Number(stock.current_price || 0);
      const cost = price * quantity;
      const coins = Number(userSnap.data()?.coins || 0);
      if (coins < cost) throw new HttpsError('failed-precondition', '코인이 부족합니다.');
      
      // [신규] 매수에 따른 가격 상승 적용
      const newPrice = applyTradeToPrice(price, quantity, true);

      const heldQty = Number(portSnap.data()?.quantity || 0);
      const heldAvg = Number(portSnap.data()?.average_buy_price || 0);
      const nextQty = heldQty + quantity;
      const nextAvg = Math.round(((heldQty * heldAvg) + (price * quantity)) / nextQty);

      tx.update(userRef, { coins: FieldValue.increment(-cost) });
      tx.set(portRef, {
        stock_id: stockId,
        quantity: nextQty,
        average_buy_price: nextAvg,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      
      // [신규] 가격 변동을 주식 문서에 업데이트
      tx.update(stockRef, { current_price: newPrice });

      return { ok: true, paid: cost, quantity: quantity, price };
    });
  });

  // ---------- onCall: 매도 ----------
  const sellStock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const stockId = String(req.data?.stockId || '').trim();
    const quantity = Math.floor(Number(req.data?.quantity || 0));
    if (!stockId || quantity <= 0) throw new HttpsError('invalid-argument', 'stockId/quantity가 올바르지 않습니다.');

    return await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const stockRef = db.collection('stocks').doc(stockId);
      const portRef = db.doc(`users/${uid}/portfolio/${stockId}`);

      const [stockSnap, portSnap] = await Promise.all([tx.get(stockRef), tx.get(portRef)]);
      if (!stockSnap.exists) throw new HttpsError('not-found', '해당 종목이 없습니다.');
      const stock = stockSnap.data();
      ensureListed(stock);

      const heldQty = Number(portSnap.data()?.quantity || 0);
      if (heldQty < quantity) throw new HttpsError('failed-precondition', '보유 수량이 부족합니다.');

      const price = Number(stock.current_price || 0);
      const income = price * quantity;
      
      // [신규] 매도에 따른 가격 하락 적용
      const newPrice = applyTradeToPrice(price, quantity, false);

      const nextQty = heldQty - quantity;
      if (nextQty > 0) {
        tx.update(portRef, {
          quantity: nextQty,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.delete(portRef);
      }
      tx.update(userRef, { coins: FieldValue.increment(income) });
      
      // [신규] 가격 변동을 주식 문서에 업데이트
      tx.update(stockRef, { current_price: newPrice });

      return { ok: true, received: income, quantity, price };
    });
  });
  
  // ... 나머지 함수 (subscribeToStock, createGuildStock, distributeDividends)는 기존과 동일 ...
  const subscribeToStock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const stockId = String(req.data?.stockId || '').trim();
    const subscribe = req.data?.subscribe; // true/false 또는 undefined(toggle)
    if (!stockId) throw new HttpsError('invalid-argument', 'stockId가 필요합니다.');

    const stockRef = db.collection('stocks').doc(stockId);
    const snap = await stockRef.get();
    if (!snap.exists) throw new HttpsError('not-found', '해당 종목이 없습니다.');

    const has = Array.isArray(snap.data().subscribers) && snap.data().subscribers.includes(uid);
    const op = (subscribe === true || (subscribe === undefined && !has))
      ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid);

    await stockRef.update({ subscribers: op });
    return { ok: true, subscribed: (subscribe === true || (subscribe === undefined && !has)) };

  });

  // ---------- onCall: 길드 상장 ----------
  const createGuildStock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const guildId = String(req.data?.guildId || '').trim();
    if (!guildId) throw new HttpsError('invalid-argument', 'guildId가 필요합니다.');

    return await db.runTransaction(async (tx) => {
      const guildRef = db.collection('guilds').doc(guildId);
      const guildSnap = await tx.get(guildRef);
      if (!guildSnap.exists) throw new HttpsError('not-found', '길드를 찾을 수 없습니다.');
      const g = guildSnap.data();
      if (g.owner_uid !== uid) throw new HttpsError('permission-denied', '길드장만 상장할 수 있습니다.');

      const stockId = `guild_${guildId}`;
      const stockRef = db.collection('stocks').doc(stockId);
      const stockExist = await tx.get(stockRef);
      if (stockExist.exists) throw new HttpsError('already-exists', '이미 상장된 길드입니다.');

      // 초기 가격 산식(간단 버전)
      const level = Number(g.level || 1);
      const members = Number(g.member_count || 1);
      const weekly = Number(g.weekly_points || 0);
      const coins = Number(g.coins || 0);
      const base = (level * 100) + (members * 5) + Math.floor(weekly / 10) + Math.floor(coins / 100);
      const initPrice = clamp(base, 10, 100000);

      tx.set(stockRef, {
        name: `길드: ${g.name || guildId}`,
        type: 'guild',
        guild_id: guildId,
        status: 'listed',
        current_price: initPrice,
        price_history: [{ date: nowISO(), price: initPrice }],
        subscribers: [],
        // [수정] upcoming_event 필드 삭제
      });

      // 주식 금고 필드 준비
      tx.set(guildRef, { stock_treasury: FieldValue.increment(0) }, { merge: true });

      return { ok: true, stockId, price: initPrice };
    });
  });

  // ---------- onCall: 배당 ----------
  const distributeDividends = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const stockId = String(req.data?.stockId || '').trim();
    const amount = Math.floor(Number(req.data?.amount || 0));
    if (!stockId || amount <= 0) throw new HttpsError('invalid-argument', 'stockId/amount가 올바르지 않습니다.');

    const stockRef = db.collection('stocks').doc(stockId);
    const stockSnap = await stockRef.get();
    if (!stockSnap.exists) throw new HttpsError('not-found', '종목이 없습니다.');
    const s = stockSnap.data();
    if (s.type !== 'guild') throw new HttpsError('failed-precondition', '길드 주식만 배당을 지원합니다.');
    const guildId = s.guild_id;
    if (!guildId) throw new HttpsError('failed-precondition', '길드 연결 정보가 없습니다.');

    // 길드장 권한 체크
    const guildRef = db.collection('guilds').doc(guildId);
    const guildSnap = await guildRef.get();
    if (!guildSnap.exists) throw new HttpsError('not-found', '길드를 찾을 수 없습니다.');
    const g = guildSnap.data();
    if (g.owner_uid !== uid) throw new HttpsError('permission-denied', '길드장만 배당할 수 있습니다.');
    const treasury = Number(g.stock_treasury || 0);
    if (treasury < amount) throw new HttpsError('failed-precondition', '길드 주식 금고 잔액이 부족합니다.');

    // 보유자 검색(전역 subcollection 쿼리)
    const holdersSnap = await db.collectionGroup('portfolio').where('stock_id', '==', stockId).get();
    if (holdersSnap.empty) throw new HttpsError('failed-precondition', '보유자가 없습니다.');

    const holders = holdersSnap.docs.map(d => ({ uid: d.ref.parent.parent.id, ...d.data() }));
    const totalShares = holders.reduce((s, h) => s + Number(h.quantity || 0), 0);
    if (totalShares <= 0) throw new HttpsError('failed-precondition', '유효한 보유 수량이 없습니다.');

    const batch = db.batch();
    let distributed = 0;
    for (const h of holders) {
      const share = Number(h.quantity || 0) / totalShares;
      const pay = Math.floor(amount * share);
      if (pay <= 0) continue;
      const userRef = db.doc(`users/${h.uid}`);
      batch.update(userRef, { coins: FieldValue.increment(pay) });
      distributed += pay;
    }
    batch.update(guildRef, { stock_treasury: treasury - distributed });
    await batch.commit();

    return { ok: true, distributed, holders: holders.length };
  });


  return {
    updateStockMarket,
    buyStock,
    sellStock,
    subscribeToStock,
    createGuildStock,
    distributeDividends,
  };
};
