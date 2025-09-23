// functions/trade.js
// 거래소(일반거래/경매) 서버 모듈
// 사용 필드: users.coins, users.coins_hold, users.items_all

module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();

  // ----- 유틸 -----
  const nowTs = () => admin.firestore.Timestamp.now();
  const dayStamp = (d = new Date()) => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };

  async function _loadCaps() {
    try {
      const snap = await db.doc('configs/item_price_caps').get();
      const d = snap.exists ? snap.data() : {};
      return {
        byId: d.byId || {}, // { [itemId]: {min,max} }
        byRarity: d.byRarity || { normal:[1,50], rare:[5,200], epic:[25,600], legend:[80,1500], myth:[160,3000], aether:[300,10000] }
      };
    } catch (_) {
      return { byId:{}, byRarity:{ normal:[1,50], rare:[5,200], epic:[25,600], legend:[80,1500], myth:[160,3000], aether:[300,10000] } };
    }
  }

  function _assert(cond, code, msg) {
    if (!cond) throw new HttpsError(code, msg);
  }

  // 아이템 이동
  function _removeItemFromUser(tx, userRef, userSnap, itemId) {
    const items = Array.isArray(userSnap.get('items_all')) ? [...userSnap.get('items_all')] : [];
    const idx = items.findIndex(it => String(it?.id) === String(itemId));
    _assert(idx >= 0, 'failed-precondition', '인벤토리에 해당 아이템이 없어');
    const [item] = items.splice(idx, 1);
    tx.update(userRef, { items_all: items });
    return item;
  }
  function _addItemToUser(tx, userRef, itemObj) {
    const FieldValue = admin.firestore.FieldValue;
    tx.set(userRef, { items_all: FieldValue.arrayUnion(itemObj) }, { merge:true });
  }

  // 코인 처리
  function _pay(tx, userRef, userSnap, amount) {
    const coins = Number(userSnap.get('coins')||0);
    _assert(coins >= amount, 'failed-precondition', '골드가 부족해');
    tx.update(userRef, { coins: coins - amount });
  }
  function _give(tx, userRef, amount) {
    const FieldValue = admin.firestore.FieldValue;
    tx.set(userRef, { coins: FieldValue.increment(amount) }, { merge:true });
  }

  // 에스크로(경매)
  function _hold(tx, userRef, userSnap, amount) {
    const coins = Number(userSnap.get('coins')||0);
    const hold = Number(userSnap.get('coins_hold')||0);
    _assert(coins >= amount, 'failed-precondition', '골드가 부족해(입찰 보증금)');
    tx.update(userRef, { coins: coins - amount, coins_hold: hold + amount });
  }
  function _release(tx, userRef, userSnap, amount) {
    const hold = Number(userSnap.get('coins_hold')||0);
    _assert(hold >= amount, 'internal', '보증금 해제 불가');
    tx.update(userRef, { coins: Number(userSnap.get('coins')||0) + amount, coins_hold: hold - amount });
  }
  function _capture(tx, userRef, userSnap, amount) {
    const hold = Number(userSnap.get('coins_hold')||0);
    _assert(hold >= amount, 'internal', '보증금 확정 불가');
    tx.update(userRef, { coins_hold: hold - amount });
  }

  // 일반거래 일일 5회 등록 제한
  function _bumpDailyTradeCount(tx, userRef, userSnap) {
    const today = dayStamp();
    const curDay = userSnap.get('trade_listed_day');
    const curCnt = Number(userSnap.get('trade_listed_count')||0);
    if (curDay !== today) {
      tx.update(userRef, { trade_listed_day: today, trade_listed_count: 1 });
      return 1;
    } else {
      _assert(curCnt < 5, 'resource-exhausted', '오늘 일반거래 등록 5회 초과야');
      tx.update(userRef, { trade_listed_count: curCnt + 1 });
      return curCnt + 1;
    }
  }

  async function _getCapsForItem(item) {
    const caps = await _loadCaps();
    const id = String(item?.id||'');
    if (id && caps.byId[id]) return caps.byId[id];
    const rar = String(item?.rarity||'normal').toLowerCase();
    const [min,max] = caps.byRarity[rar] || caps.byRarity.normal;
    return { min, max };
  }

  // ========== [일반거래] ==========
  const tradeCol = db.collection('market_trades');

  const tradeCreateListing = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');

    const { itemId, price } = req.data || {};
    _assert(itemId && Number.isFinite(Number(price)), 'invalid-argument', '잘못된 입력');

    const userRef = db.doc(`users/${uid}`);
    const listingRef = tradeCol.doc();
    let outId = listingRef.id;

    await db.runTransaction(async (tx)=>{
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');

      // 일일 등록 카운터 +1 (<=5)
      _bumpDailyTradeCount(tx, userRef, userSnap);

      // 아이템 꺼내기
      const item = _removeItemFromUser(tx, userRef, userSnap, String(itemId));

      // 가격 캡
      const { min, max } = await _getCapsForItem(item);
      const p = Math.floor(Number(price));
      _assert(p >= min && p <= max, 'failed-precondition', `가격은 ${min}~${max} 골드만 가능해`);

      tx.set(listingRef, {
        status:'active', seller_uid: uid, price: p, item,
        createdAt: nowTs()
      });
    });

    return { ok:true, id: outId };
  });

  const tradeListPublic = onCall({ region:'us-central1' }, async (_req)=>{
  // 인덱스가 준비되어 있다면 where+orderBy 사용, 아니면 orderBy만 써도 무방
  const snap = await tradeCol.where('status','==','active').orderBy('createdAt','desc').limit(80).get();

  // 공개 응답: 아이템 스펙은 감추고 최소 정보만
  const rows = snap.docs.map(d=>{
    const x = d.data(); const it = x.item || {};
    return {
      id: d.id,
      price: Number(x.price||0),
      seller_uid: x.seller_uid,        // 구매/신고 등에 필요하면 유지
      item_id: String(it.id||''),
      item_name: String(it.name||''),  // 이름/등급은 “보여짐” 요구사항 충족
      item_rarity: String(it.rarity||'normal'),
      createdAt: x.createdAt
    };
  });
  return { ok:true, rows };
});


  const tradeBuy = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');

    const ref = tradeCol.doc(String(listingId));
    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '리스트 없음');
      const L = snap.data();
      _assert(L.status==='active', 'failed-precondition', '이미 판매됨');
      _assert(L.seller_uid !== uid, 'failed-precondition', '내 물건은 내가 못 사');

      const buyerRef = db.doc(`users/${uid}`);
      const sellerRef = db.doc(`users/${L.seller_uid}`);
      const buyer = await tx.get(buyerRef);
      const seller = await tx.get(sellerRef);
      _assert(buyer.exists && seller.exists, 'not-found', '유저 정보 없음');

      // 구매자 결제
      _pay(tx, buyerRef, buyer, Number(L.price||0));
      // 판매자 수령
      _give(tx, sellerRef, Number(L.price||0));
      // 아이템 전달
      _addItemToUser(tx, buyerRef, L.item);

      tx.update(ref, { status:'sold', buyer_uid: uid, soldAt: nowTs() });
    });

    return { ok:true };
  });

  // ========== [경매(일반/특수)] ==========
  const aucCol = db.collection('market_auctions');
  const MIN_MINUTES = 30; // 최소 경매 시간(분)
  const MIN_STEP = 1;     // 최소 호가 단위

  const auctionCreate = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');

    const { itemId, minBid, minutes, kind } = req.data || {};
    const k = (kind==='special') ? 'special' : 'normal';
    const dur = Math.max(MIN_MINUTES, Math.floor(Number(minutes||MIN_MINUTES)));
    _assert(itemId && Number.isFinite(Number(minBid)), 'invalid-argument', '잘못된 입력');

    const userRef = db.doc(`users/${uid}`);
    const aucRef = aucCol.doc();
    let outId = aucRef.id;

    await db.runTransaction(async (tx)=>{
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');

      // 등록 즉시 취소 불가 — 정책만, 별도 필드 필요X
      const item = _removeItemFromUser(tx, userRef, userSnap, String(itemId));

      // (참고) 가격 캡을 경매 시작가에 적용하고 싶다면 아래 주석 해제
      // const { min, max } = await _getCapsForItem(item);
      // const s = Math.floor(Number(minBid));
      // _assert(s >= min && s <= max, 'failed-precondition', `시작가는 ${min}~${max} 사이여야 해`);

      const endMs = Date.now() + dur*60*1000;
      tx.set(aucRef, {
        status:'active', seller_uid: uid, kind: k,
        minBid: Math.max(1, Math.floor(Number(minBid))),
        topBid: null,
        endsAt: admin.firestore.Timestamp.fromMillis(endMs),
        item, createdAt: nowTs()
      });
    });

    return { ok:true, id: outId };
  });

  const auctionListPublic = onCall({ region:'us-central1' }, async (req)=>{
  const kindReq = (req.data?.kind === 'special') ? 'special' : null;
  let q = aucCol.where('status','==','active');
  if (kindReq) q = q.where('kind','==',kindReq);
  const snap = await q.orderBy('createdAt','desc').limit(120).get();

  const rows = snap.docs.map(d=>{
    const x = d.data(); const it = x.item || {};
    if (x.kind === 'special') {
      // 특수 경매: 등급/스펙 감춤, 서술만
      return {
        id: d.id, kind: x.kind,
        minBid: Number(x.minBid||1),
        topBid: x.topBid || null,
        endsAt: x.endsAt, createdAt: x.createdAt,
        item_id: String(it.id||''),
        description: String(it.desc || it.desc_short || '')
      };
    }
    // 일반 경매: 등급 “보여짐”
    return {
      id: d.id, kind: x.kind,
      minBid: Number(x.minBid||1),
      topBid: x.topBid || null,
      endsAt: x.endsAt, createdAt: x.createdAt,
      item_id: String(it.id||''),
      item_name: String(it.name||''),
      item_rarity: String(it.rarity||'normal')
    };
  });

  return { ok:true, rows };
});


  const auctionBid = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { auctionId, amount } = req.data || {};
    _assert(auctionId && Number.isFinite(Number(amount)), 'invalid-argument', '잘못된 입력');

    const ref = aucCol.doc(String(auctionId));
    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '경매 없음');
      const A = snap.data();
      _assert(A.status==='active', 'failed-precondition', '종료된 경매야');
      _assert(A.seller_uid !== uid, 'failed-precondition', '내 경매엔 입찰 불가');
      _assert(A.endsAt?.toMillis() > Date.now(), 'failed-precondition', '이미 마감됨');

      const bid = Math.floor(Number(amount));
      const minOk = Math.max(Number(A.minBid||1), (A.topBid?.amount||0) + MIN_STEP);
      _assert(bid >= minOk, 'failed-precondition', `입찰가는 최소 ${minOk} 이상이어야 해`);

      const meRef = db.doc(`users/${uid}`);
      const me = await tx.get(meRef);
      _assert(me.exists, 'not-found', '유저 없음');

      // 새 입찰자 홀드
      _hold(tx, meRef, me, bid);

      // 기존 1등 있으면 환불
      if (A.topBid?.uid) {
        const prevRef = db.doc(`users/${A.topBid.uid}`);
        const prev = await tx.get(prevRef);
        if (prev.exists) _release(tx, prevRef, prev, Number(A.topBid.amount||0));
      }

      // 탑 입찰 갱신
      tx.update(ref, {
        topBid: { uid, amount: bid },
        updatedAt: nowTs()
      });

      // 입찰 로그(필요시)
      tx.set(ref.collection('bids').doc(), { uid, amount: bid, at: nowTs() });
    });

    return { ok:true };
  });

  const auctionSettle = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid; // 호출자 아무나 가능(공개 정산)
    _assert(uid, 'unauthenticated', '로그인이 필요해');

    const { auctionId } = req.data || {};
    _assert(auctionId, 'invalid-argument', 'auctionId 필요');

    const ref = aucCol.doc(String(auctionId));
    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '경매 없음');
      const A = snap.data();
      _assert(A.status==='active', 'failed-precondition', '이미 정산됨');
      _assert(A.endsAt?.toMillis() <= Date.now(), 'failed-precondition', '아직 마감 전이야');

      const sellerRef = db.doc(`users/${A.seller_uid}`);
      const seller = await tx.get(sellerRef);
      _assert(seller.exists, 'not-found', '판매자 정보 없음');

      if (A.topBid?.uid) {
        // 낙찰 정산
        const winRef = db.doc(`users/${A.topBid.uid}`);
        const win = await tx.get(winRef);
        _assert(win.exists, 'not-found', '낙찰자 정보 없음');

        _capture(tx, winRef, win, Number(A.topBid.amount||0)); // 보증금 확정 차감
        _give(tx, sellerRef, Number(A.topBid.amount||0));      // 판매자 수령
        _addItemToUser(tx, winRef, A.item);                    // 아이템 지급

        tx.update(ref, { status:'sold', buyer_uid: A.topBid.uid, soldAt: nowTs() });
      } else {
        // 유찰: 서버가 1골드에 사감(판매자 1골드 지급, 아이템 소각 처리)
        _give(tx, sellerRef, 1);
        tx.update(ref, { status:'system_sold', buyer_uid:'__system__', soldAt: nowTs() });
      }
    });

    return { ok:true };
  });

  return {
    tradeCreateListing,
    tradeListPublic,
    tradeBuy,
    auctionCreate,
    auctionListPublic,
    auctionBid,
    auctionSettle,
  };
};
