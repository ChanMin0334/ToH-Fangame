// /functions/stockmarket.js (전체 수정)
module.exports = (admin, { onCall, HttpsError, logger, onSchedule /*, GEMINI_API_KEY*/ }) => {
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  // ---------- helpers ----------
  const nowISO = () => new Date().toISOString();
  const dayStamp = (d = new Date()) => d.toISOString().slice(0, 10); // YYYY-MM-DD
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // 이벤트 기반 가격 변동 로직
  const applyEventToPrice = (cur, dir, mag) => {
    const randomFactor = 1 + (Math.random() - 0.5) * 0.4; // 0.8 ~ 1.2
    const rateBase = { small: 0.03, medium: 0.08, large: 0.15 }[mag] ?? 0.05;
    const finalRate = rateBase * randomFactor;
    const rate = dir === 'up' ? finalRate : dir === 'down' ? -finalRate : 0;
    return Math.max(1, Math.round(cur * (1 + rate)));
  };

  // 거래량 기반 가격 변동 로직 (변동폭 제한 없음)
  const applyTradeToPrice = (currentPrice, quantity, isBuy) => {
    const baseRate = 0.001;
    const changeRate = baseRate * (quantity / 100);
    const multiplier = isBuy ? (1 + changeRate) : (1 - changeRate);
    return Math.max(1, Math.round(currentPrice * multiplier));
  };

  const ensureListed = (s) => {
    if (!s || s.status !== 'listed') throw new HttpsError('failed-precondition', '상장 상태가 아닙니다.');
  };


  // ==================================================================
  // [신규] 1. 일일 주가 계획 스케줄러 (매일 00:00 실행)
  // ==================================================================
  const planDailyStockEvents = onSchedule({
    schedule: 'every day 00:00',
    timeZone: 'Asia/Seoul',
    region: 'us-central1',
  }, async () => {
    logger.info('매일 자정, 주식 시장 일일 계획을 생성합니다.');
    const today = dayStamp();
    const stocksSnap = await db.collection('stocks').where('status', '==', 'listed').get();

    for (const doc of stocksSnap.docs) {
      const stock = doc.data();
      const planRef = db.collection('stock_daily_plans').doc(`${doc.id}_${today}`);

      // 오늘의 시가 = 어제의 종가
      const openPrice = stock.current_price || 100;
      
      // 오늘의 트렌드 및 목표가 랜덤 결정
      const trendRoll = Math.random();
      let trend, targetMultiplier;
      if (trendRoll < 0.1) { trend = 'strong_up'; targetMultiplier = 1.15 + Math.random() * 0.1; }
      else if (trendRoll < 0.4) { trend = 'up'; targetMultiplier = 1.05 + Math.random() * 0.05; }
      else if (trendRoll < 0.6) { trend = 'stable'; targetMultiplier = 1.0 + (Math.random() - 0.5) * 0.04; }
      else if (trendRoll < 0.9) { trend = 'down'; targetMultiplier = 0.95 - Math.random() * 0.05; }
      else { trend = 'strong_down'; targetMultiplier = 0.85 - Math.random() * 0.1; }

      const targetPrice = Math.max(1, Math.round(openPrice * targetMultiplier));

      // 중대 사건(뉴스) 생성 (0~2회)
      const majorEvents = [];
      const numEvents = Math.floor(Math.random() * 3);
      const dayMinutes = 24 * 60;
      for (let i = 0; i < numEvents; i++) {
        const triggerMinute = Math.floor(Math.random() * dayMinutes);
        const eventDir = Math.random() < 0.5 ? 'up' : 'down';
        majorEvents.push({
          trigger_minute: triggerMinute,
          direction: eventDir,
          magnitude: 'large', // 중대 사건은 'large'로 고정
          news_generated: false,
          processed: false,
        });
      }
      
      await planRef.set({
        stock_id: doc.id,
        date: today,
        open_price: openPrice,
        target_price: targetPrice,
        daily_trend: trend,
        major_events: majorEvents,
      });
    }
  });


  // ==================================================================
  // [수정] 2. 1분 단위 가격 업데이트 스케줄러
  // ==================================================================
  const updateStockMarket = onSchedule({
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Seoul',
    region: 'us-central1',
  }, async () => {
    const today = dayStamp();
    const now = new Date();
    const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
    
    const plansSnap = await db.collection('stock_daily_plans').where('date', '==', today).get();
    
    for (const planDoc of plansSnap.docs) {
      const plan = planDoc.data();
      const stockRef = db.collection('stocks').doc(plan.stock_id);
      
      await db.runTransaction(async (tx) => {
        const stockSnap = await tx.get(stockRef);
        if (!stockSnap.exists) return;
        const stock = stockSnap.data();
        let price = stock.current_price;

        // 중대 사건 처리
        let eventTriggered = false;
        const events = plan.major_events || [];
        for (const event of events) {
          if (event.trigger_minute === currentMinute && !event.processed) {
            price = applyEventToPrice(price, event.direction, event.magnitude);
            event.processed = true;
            eventTriggered = true;
            logger.info(`중대 사건 발생: ${stock.name}, ${event.direction}/${event.magnitude}`);
            
            // 뉴스 발송 (중대 사건에 대해서만)
            const subscribers = stock.subscribers || [];
            if (subscribers.length > 0) {
              const news = {
                title: `[속보] ${stock.name} 주가에 중대한 변동 발생`,
                body: `${stock.name} 종목에 예측된 대규모 변동(${event.direction})이 실제 가격에 반영되었습니다.`,
              };
              const mailTasks = subscribers.map(uid => {
                const mailRef = db.collection('mail').doc(uid).collection('msgs').doc();
                return tx.set(mailRef, {
                  kind: 'etc', title: `[주식 속보] ${stock.name}`, body: `${news.title}\n\n${news.body}`,
                  sentAt: FieldValue.serverTimestamp(), from: '증권 정보국', read: false,
                  attachments: { ref_type: 'stock', ref_id: stock.id },
                });
              });
            }
            break; 
          }
        }
        
        // 잔물결 변동 (중대 사건이 없었을 경우에만)
        if (!eventTriggered) {
          const target = plan.target_price;
          const diff = target - price;
          // 목표가를 향해 소폭 이동 + 약간의 랜덤 노이즈
          const noise = (Math.random() - 0.5) * (price * 0.005);
          const move = (diff / (dayMinutes - currentMinute + 1)) * (1 + Math.random() * 0.5);
          price = Math.max(1, Math.round(price + move + noise));
        }

        const history = (stock.price_history || []).slice(-1439); // 24시간(1440분) 데이터 유지
        history.push({ date: nowISO(), price });

        tx.update(stockRef, { current_price: price, price_history: history });
        // 이벤트 처리 상태 업데이트
        if(eventTriggered) {
          tx.update(planDoc.ref, { major_events: events });
        }
      });
    }
  });
  
  // ( ... 기존 매수/매도/구독/상장/배당 함수는 그대로 유지 ... )
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
      
      tx.update(stockRef, { current_price: newPrice });

      return { ok: true, received: income, quantity, price };
    });
  });
  
  const subscribeToStock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const stockId = String(req.data?.stockId || '').trim();
    const subscribe = req.data?.subscribe;
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

      const level = Number(g.level || 1);
      const members = Number(g.member_count || 1);
      const weekly = Number(g.weekly_points || 0);
      const coins = Number(g.coins || 0);
      const base = (level * 100) + (members * 5) + Math.floor(weekly / 10) + Math.floor(coins / 100);
      const initPrice = clamp(base, 10, 100000);

      tx.set(stockRef, {
        name: `길드: ${g.name || guildId}`, type: 'guild', guild_id: guildId, status: 'listed',
        current_price: initPrice, price_history: [{ date: nowISO(), price: initPrice }],
        subscribers: [],
      });

      tx.set(guildRef, { stock_treasury: FieldValue.increment(0) }, { merge: true });
      return { ok: true, stockId, price: initPrice };
    });
  });

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

    const guildRef = db.collection('guilds').doc(guildId);
    const guildSnap = await guildRef.get();
    if (!guildSnap.exists) throw new HttpsError('not-found', '길드를 찾을 수 없습니다.');
    const g = guildSnap.data();
    if (g.owner_uid !== uid) throw new HttpsError('permission-denied', '길드장만 배당할 수 있습니다.');
    const treasury = Number(g.stock_treasury || 0);
    if (treasury < amount) throw new HttpsError('failed-precondition', '길드 주식 금고 잔액이 부족합니다.');

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
    planDailyStockEvents,
    updateStockMarket,
    buyStock,
    sellStock,
    subscribeToStock,
    createGuildStock,
    distributeDividends,
  };
};
