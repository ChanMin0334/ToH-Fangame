// /functions/stockmarket.js (전체 수정)
module.exports = (admin, { onCall, HttpsError, logger, onSchedule, GEMINI_API_KEY }) => {
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  // ---------- helpers ----------
  const nowISO = () => new Date().toISOString();
  const dayStamp = (d = new Date()) => {
      const kstOffset = 9 * 60 * 60 * 1000;
      const kstDate = new Date(d.getTime() + kstOffset);
      return kstDate.toISOString().slice(0, 10);
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

async function callGemini(model, system, user) {
  const key = GEMINI_API_KEY.value(); // defineSecret 사용
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [
      { role: "user", parts: [{ text: `[SYSTEM]\n${system}\n\n[USER]\n${user}` }] }
    ],
    generationConfig: { temperature: 0.8, maxOutputTokens: 512 }
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error(`Gemini response malformed: ${JSON.stringify(json).slice(0, 200)}`);
  return text;
}


  const applyEventToPrice = (cur, dir, mag) => {
    const randomFactor = 1 + (Math.random() - 0.5) * 0.4;
    const rateBase = { small: 0.03, medium: 0.08, large: 0.20, massive: 0.35 }[mag] ?? 0.05;
    const finalRate = rateBase * randomFactor;
    const rate = dir === 'up' ? finalRate : dir === 'down' ? -finalRate : 0;
    return Math.max(1, Math.round(cur * (1 + rate)));
  };

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
  // 1. 일일 AI 이벤트 계획 스케줄러 (매일 00:05 KST 실행)
  // ==================================================================
  const planDailyStockEvents = onSchedule({
    schedule: '5 0 * * *',
    timeZone: 'Asia/Seoul', region: 'us-central1',
    secrets: [GEMINI_API_KEY],
  }, async () => {

    logger.info('매일 자정, AI 기반 주식 시장 이벤트를 생성합니다.');
    const today = dayStamp();
    const stocksSnap = await db.collection('stocks').where('status', '==', 'listed').get();
    const worldsSnap = await db.collection('configs').doc('worlds').get();
    const worldsData = worldsSnap.exists() ? worldsSnap.data() : {};

    for (const doc of stocksSnap.docs) {
        const stock = doc.data();
        const planRef = db.collection('stock_events').doc(`${doc.id}_${today}`);
        const worldInfo = (worldsData.worlds || []).find(w => w.id === stock.world_id) || { name: stock.world_id, intro: '알려지지 않은 세계' };

        // AI에게 이벤트 아이디어 요청
        const systemPrompt = `당신은 게임 속 주식 시장의 흥미로운 사건을 만드는 AI입니다. 주어진 주식회사와 세계관 정보를 바탕으로, 주가에 영향을 미칠 만한 그럴듯한 사건의 '전조'를 만드세요. 결과는 반드시 다음 JSON 형식이어야 합니다: {"premise": "사건의 배경 설명 (예: A공장에서 신기술이 발견되었다는 소문)", "title_before": "결과가 나오기 전 투자자들을 긴장시킬 뉴스 헤드라인", "potential_impact": "positive 또는 negative 중 하나"}`;
        const userPrompt = `주식회사 정보: ${JSON.stringify(stock)}\n세계관 정보: ${JSON.stringify(worldInfo)}`;
        
        const numEvents = Math.floor(Math.random() * 3); // 하루 0~2회
        const majorEvents = [];

        for (let i = 0; i < numEvents; i++) {
            try {
                const ideaRaw = await callGemini('gemini-1.5-flash', systemPrompt, userPrompt);
                const idea = JSON.parse(ideaRaw);
                
                const triggerMinute = Math.floor(Math.random() * (24 * 60));
                const actual_outcome = Math.random() < 0.7 ? idea.potential_impact : (idea.potential_impact === 'positive' ? 'negative' : 'positive');

                majorEvents.push({
                    premise: idea.premise,
                    title_before: idea.title_before,
                    potential_impact: idea.potential_impact,
                    actual_outcome: actual_outcome,
                    trigger_minute: triggerMinute,
                    forecast_sent: false,
                    processed: false,
                });
            } catch (e) {
                logger.error(`AI 이벤트 생성 실패 (Stock ID: ${doc.id}):`, e);
            }
        }
        
        if (majorEvents.length > 0) {
            await planRef.set({ stock_id: doc.id, date: today, major_events: majorEvents });
        }
      // [신규] 일일 잔물결 계획(목표가/트렌드) 초기화
const dailyRef = db.collection('stock_daily_plans').doc(`${doc.id}_${today}`);
const basePrice = Number(stock.current_price || 0);
const trendSign = Math.random() < 0.5 ? -1 : 1;  // 하루 방향성
const driftBps = ({ low: 2, normal: 5, high: 10 }[stock.volatility] ?? 5); // 분당 bps
await dailyRef.set({
  stock_id: doc.id,
  date: today,
  target_price: basePrice,
  trend_sign: trendSign,   // -1, +1
  drift_bps: driftBps      // 분당 기초 변동폭(베이시스 포인트)
}, { merge: true });

    }
  });

  // ==================================================================
  // 2. 1분 단위 가격 업데이트 스케줄러
  // ==================================================================
  const updateStockMarket = onSchedule({
    schedule: 'every 1 minutes', timeZone: 'Asia/Seoul', region: 'us-central1',
    secrets: [GEMINI_API_KEY],
  }, async () => {

    const today = dayStamp();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    
    const plansSnap = await db.collection('stock_events').where('date', '==', today).get();
    
    for (const planDoc of plansSnap.docs) {
        const plan = planDoc.data();
        const stockRef = db.collection('stocks').doc(plan.stock_id);

        await db.runTransaction(async (tx) => {
            const [stockSnap, planSnap] = await Promise.all([tx.get(stockRef), tx.get(planDoc.ref)]);
            if (!stockSnap.exists || !planSnap.exists) return;
            
            const stock = stockSnap.data();
            const currentPlan = planSnap.data();
            let price = stock.current_price;
            let planUpdated = false;

            const events = currentPlan.major_events || [];
            for (const event of events) {
                // 1단계: 예고 기사 발송
                if (event.trigger_minute === currentMinute && !event.forecast_sent) {
                    const subscribers = stock.subscribers || [];
                    subscribers.forEach(uid => {
                        const mailRef = db.collection('mail').doc(uid).collection('msgs').doc();
                        tx.set(mailRef, {
                            kind: 'etc', title: `[주식 속보] ${stock.name}`, body: event.title_before,
                            sentAt: FieldValue.serverTimestamp(), from: '증권 정보국', read: false,
                        });
                    });
                    event.forecast_sent = true;
                    planUpdated = true;
                }
                  // 2단계: 실제 사건 처리 (예고 후 2분 뒤)
                  else if (event.trigger_minute + 10 === currentMinute && event.forecast_sent && !event.processed) {

                    const direction = event.actual_outcome === 'positive' ? 'up' : 'down';
                    price = applyEventToPrice(price, direction, 'large');
                    
                    // 결과 기사 생성 및 발송
                    const systemPrompt = `사건의 전말과 실제 결과가 주어졌다. 투자자들에게 충격을 줄 만한 '결과 기사'를 JSON 형식으로 작성하라: {"title_after": "결과 헤드라인", "body_after": "결과 본문"}`;
                    const userPrompt = `사건 전말: ${event.premise}\n예상: ${event.potential_impact}\n실제 결과: ${event.actual_outcome}`;
                    try {
                        const resultRaw = await callGemini('gemini-1.5-flash', systemPrompt, userPrompt);
                        const news = JSON.parse(resultRaw);
                        const subscribers = stock.subscribers || [];
                        subscribers.forEach(uid => {
                            const mailRef = db.collection('mail').doc(uid).collection('msgs').doc();
                            tx.set(mailRef, {
                                kind: 'etc', title: `[주식 결과] ${stock.name}`, body: `${news.title_after}\n\n${news.body_after}`,
                                sentAt: FieldValue.serverTimestamp(), from: '증권 정보국', read: false,
                            });
                        });
                    } catch(e) { logger.error('결과 기사 생성 실패:', e); }

                    event.processed = true;
                    planUpdated = true;
                }
            }

          // [신규] 잔물결 업데이트: 이벤트가 가격을 바꾸지 않은 분일 때 소폭 변동
const didMoveByEvent = events.some(ev =>
  ev.forecast_sent && ev.processed && (ev.trigger_minute + 10 === currentMinute)
);
if (!didMoveByEvent) {
  const dailyRef = db.collection('stock_daily_plans').doc(`${plan.stock_id}_${today}`);
  const dailySnap = await tx.get(dailyRef);
  const d = dailySnap.exists ? dailySnap.data() : {};
  const driftBps = Math.max(1, Math.min(30, Number(d.drift_bps || 5))); // 가드
  const sign = (d.trend_sign === -1 || d.trend_sign === 1) ? d.trend_sign : (Math.random()<0.5?-1:1);
  
  // 목표가 방향으로 1분에 gap의 3% 정도 접근 + 미세 드리프트
  const gap = Number(d.target_price || price) - price;
  const toward = Math.sign(gap) * Math.max(0, Math.floor(Math.abs(gap) * 0.03));
  const micro = Math.max(1, Math.round(price * (driftBps / 10000) * sign));
  price = Math.max(1, price + toward + micro);

  // 목표가도 미세 이동 (시장 심리 누적)
  if (dailySnap.exists) {
    tx.update(dailyRef, { target_price: Math.max(1, Number(d.target_price || price) + micro) });
  }
}


            const history = (stock.price_history || []).slice(-1439);
            history.push({ date: nowISO(), price });
            tx.update(stockRef, { current_price: price, price_history: history });
            
            if (planUpdated) {
                tx.update(planDoc.ref, { major_events: events });
            }
        });
    }
  });
  
  // ==================================================================
  // [수정] 3. 매수/매도 함수: 일일 계획의 목표가를 수정하도록 변경
  // ==================================================================
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
      const planRef = db.collection('stock_daily_plans').doc(`${stockId}_${dayStamp()}`);

      const [userSnap, stockSnap, portSnap, planSnap] = await Promise.all([tx.get(userRef), tx.get(stockRef), tx.get(portRef), tx.get(planRef)]);
      if (!stockSnap.exists) throw new HttpsError('not-found', '해당 종목이 없습니다.');
      const stock = stockSnap.data();
      ensureListed(stock);

      const price = Number(stock.current_price || 0);
      const cost = price * quantity;
      const coins = Number(userSnap.data()?.coins || 0);
      if (coins < cost) throw new HttpsError('failed-precondition', '코인이 부족합니다.');
      
      const newPrice = applyTradeToPrice(price, quantity, true);

      // 목표가 조정 로직
      if (planSnap.exists) {
        const plan = planSnap.data();
        const currentTarget = plan.target_price || price;
        const impact = Math.round(cost * 0.0005); // 거래대금의 0.05%만큼 목표가 상승
        tx.update(planRef, { target_price: currentTarget + impact });
      }

      const heldQty = Number(portSnap.data()?.quantity || 0);
      const heldAvg = Number(portSnap.data()?.average_buy_price || 0);
      const nextQty = heldQty + quantity;
      const nextAvg = Math.round(((heldQty * heldAvg) + (price * quantity)) / nextQty);

      tx.update(userRef, { coins: FieldValue.increment(-cost) });
      tx.set(portRef, { stock_id: stockId, quantity: nextQty, average_buy_price: nextAvg, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      // 히스토리 1,440개 유지 + 새 현재가 기록 푸시
      const histBuy = Array.isArray(stock.price_history) ? stock.price_history.slice(-1439) : [];
      histBuy.push({ date: nowISO(), price: Number(newPrice) });
      tx.update(stockRef, { current_price: Number(newPrice), price_history: histBuy });


      return { ok: true, paid: cost, quantity: quantity, price };
    });
  });

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
      const planRef = db.collection('stock_daily_plans').doc(`${stockId}_${dayStamp()}`);

      const [userSnap, stockSnap, portSnap, planSnap] = await Promise.all([tx.get(userRef), tx.get(stockRef), tx.get(portRef), tx.get(planRef)]);
      if (!stockSnap.exists) throw new HttpsError('not-found', '해당 종목이 없습니다.');
      const stock = stockSnap.data();
      ensureListed(stock);

      const heldQty = Number(portSnap.data()?.quantity || 0);
      if (heldQty < quantity) throw new HttpsError('failed-precondition', '보유 수량이 부족합니다.');

      const price = Number(stock.current_price || 0);
      const income = price * quantity;
      
      const newPrice = applyTradeToPrice(price, quantity, false);

      // 목표가 조정 로직
      if (planSnap.exists) {
        const plan = planSnap.data();
        const currentTarget = plan.target_price || price;
        const impact = Math.round(income * 0.0005); // 거래대금의 0.05%만큼 목표가 하락
        tx.update(planRef, { target_price: currentTarget - impact });
      }

      const nextQty = heldQty - quantity;
      if (nextQty > 0) {
        tx.update(portRef, { quantity: nextQty, updatedAt: FieldValue.serverTimestamp() });
      } else { tx.delete(portRef); }
      tx.update(userRef, { coins: FieldValue.increment(income) });
      const histSell = Array.isArray(stock.price_history) ? stock.price_history.slice(-1439) : [];
      histSell.push({ date: nowISO(), price: Number(newPrice) });
      tx.update(stockRef, { current_price: Number(newPrice), price_history: histSell });


      return { ok: true, received: income, quantity, price };
    });
  });
  
  // ( ... 기존 구독/상장/배당 함수는 그대로 유지 ... )
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
    const op = (subscribe === true || (subscribe === undefined && !has)) ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid);
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
      const level = Number(g.level || 1), members = Number(g.member_count || 1), weekly = Number(g.weekly_points || 0), coins = Number(g.coins || 0);
      const base = (level * 100) + (members * 5) + Math.floor(weekly / 10) + Math.floor(coins / 100);
      const initPrice = clamp(base, 10, 100000);
      tx.set(stockRef, {
        name: `길드: ${g.name || guildId}`, type: 'guild', guild_id: guildId, status: 'listed',
        current_price: initPrice, price_history: [{ date: nowISO(), price: initPrice }], subscribers: [],
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
