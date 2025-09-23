// functions/trade.js

module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();

  // ----- 유틸 -----
  const nowTs = () => admin.firestore.Timestamp.now();
  const dayStamp = (d = new Date()) => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };

  function _assert(cond, code, msg) {
    if (!cond) throw new HttpsError(code, msg);
  }

  // [신규] 아이템 기준 가격 계산 함수 (상점 판매가 로직과 동일)
  function _calculatePrice(item) {
    const prices = {
      consumable: { normal: 1, rare: 5, epic: 25, legend: 50, myth: 100, aether: 250 },
      non_consumable: { normal: 2, rare: 10, epic: 50, legend: 100, myth: 200, aether: 500 }
    };
    const isConsumable = item.isConsumable || item.consumable || item.consume;
    const priceTier = isConsumable ? prices.consumable : prices.non_consumable;
    return priceTier[item.rarity] || 0;
  };

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

  // ========== [일반거래] ==========
  const tradeCol = db.collection('market_trades');

  // [수정] 가격 제한 로직 추가
  const tradeCreateListing = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');

    const { itemId, price } = req.data || {};
    _assert(itemId && Number.isFinite(Number(price)), 'invalid-argument', '잘못된 입력');

    const userRef = db.doc(`users/${uid}`);
    const listingRef = tradeCol.doc();

    await db.runTransaction(async (tx)=>{
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');

      _bumpDailyTradeCount(tx, userRef, userSnap);
      const item = _removeItemFromUser(tx, userRef, userSnap, String(itemId));

      // [핵심 수정] 기준가의 +-50% 가격 제한 적용
      const basePrice = _calculatePrice(item);
      _assert(basePrice > 0, 'invalid-argument', '가격을 산정할 수 없는 아이템이야');
      const minPrice = Math.floor(basePrice * 0.5);
      const maxPrice = Math.floor(basePrice * 1.5);
      const p = Math.floor(Number(price));
      _assert(p >= minPrice && p <= maxPrice, 'failed-precondition', `가격은 ${minPrice}~${maxPrice} 골드 사이만 가능해`);

      tx.set(listingRef, {
        status:'active', seller_uid: uid, price: p, item,
        createdAt: nowTs()
      });
    });

    return { ok:true, id: listingRef.id };
  });

  // [신규] 판매 취소 함수
  const tradeCancelListing = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');

    const listingRef = tradeCol.doc(String(listingId));
    await db.runTransaction(async (tx) => {
      const listingSnap = await tx.get(listingRef);
      _assert(listingSnap.exists, 'not-found', '판매 물품을 찾을 수 없어');
      const listing = listingSnap.data();

      _assert(listing.seller_uid === uid, 'permission-denied', '내 물건만 취소할 수 있어');
      _assert(listing.status === 'active', 'failed-precondition', '이미 판매되었거나 취소된 물품이야');

      const userRef = db.doc(`users/${uid}`);
      _addItemToUser(tx, userRef, listing.item);
      
      tx.update(listingRef, { status: 'cancelled', cancelledAt: nowTs() });
    });

    return { ok: true };
  });

  // [신규] 상세 정보 조회 함수
  const tradeGetListingDetail = onCall({ region:'us-central1' }, async (req) => {
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');

    const snap = await tradeCol.doc(String(listingId)).get();
    _assert(snap.exists, 'not-found', '판매 정보를 찾을 수 없어');
    
    const listing = snap.data();
    // 공개적으로 안전한 정보만 반환 (여기서는 item 객체 전체가 필요)
    return { ok: true, item: listing.item, price: listing.price, seller_uid: listing.seller_uid };
  });

  const tradeListPublic = onCall({ region:'us-central1' }, async (_req)=>{
    const snap = await tradeCol.where('status','==','active').orderBy('createdAt','desc').limit(80).get();
    const rows = snap.docs.map(d=>{
      const x = d.data(); const it = x.item || {};
      return {
        id: d.id,
        price: Number(x.price||0),
        seller_uid: x.seller_uid,
        item_id: String(it.id||''),
        item_name: String(it.name||''),
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

      _pay(tx, buyerRef, buyer, Number(L.price||0));
      _give(tx, sellerRef, Number(L.price||0));
      _addItemToUser(tx, buyerRef, L.item);

      tx.update(ref, { status:'sold', buyer_uid: uid, soldAt: nowTs() });
    });

    return { ok:true };
  });

  // [신규] 내가 등록한 거래 목록 조회
  const tradeListMyListings = onCall({ region:'us-central1' }, async (req)=>{
      const uid = req.auth?.uid;
      _assert(uid, 'unauthenticated', '로그인이 필요해');
      const snap = await tradeCol.where('seller_uid','==',uid).orderBy('createdAt','desc').limit(50).get();
      const rows = snap.docs.map(d=>{
          const x = d.data(); const it = x.item || {};
          return {
              id: d.id,
              status: x.status,
              price: Number(x.price||0),
              item_name: String(it.name||''),
              item_rarity: String(it.rarity||'normal'),
              createdAt: x.createdAt,
              soldAt: x.soldAt || null,
              buyer_uid: x.buyer_uid || null,
          };
      });
      return { ok:true, rows };
  });

  // ========== [경매(일반/특수)] ==========
  const aucCol = db.collection('market_auctions');
  const MIN_MINUTES = 30;
  const MIN_STEP = 1;

  const auctionCreate = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');

    const { itemId, minBid, minutes, kind } = req.data || {};
    const k = (kind==='special') ? 'special' : 'normal';
    const dur = Math.max(MIN_MINUTES, Math.floor(Number(minutes||MIN_MINUTES)));
    _assert(itemId && Number.isFinite(Number(minBid)), 'invalid-argument', '잘못된 입력');

    const userRef = db.doc(`users/${uid}`);
    const aucRef = aucCol.doc();

    await db.runTransaction(async (tx)=>{
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');
      const item = _removeItemFromUser(tx, userRef, userSnap, String(itemId));
      const endMs = Date.now() + dur*60*1000;
      tx.set(aucRef, {
        status:'active', seller_uid: uid, kind: k,
        minBid: Math.max(1, Math.floor(Number(minBid))),
        topBid: null,
        endsAt: admin.firestore.Timestamp.fromMillis(endMs),
        item, createdAt: nowTs()
      });
    });

    return { ok:true, id: aucRef.id };
  });

  const auctionListPublic = onCall({ region:'us-central1' }, async (req)=>{
    const kindReq = (req.data?.kind === 'special') ? 'special' : null;
    let q = aucCol.where('status','==','active');
    if (kindReq) q = q.where('kind','==',kindReq);
    const snap = await q.orderBy('createdAt','desc').limit(120).get();

    const rows = snap.docs.map(d=>{
      const x = d.data(); const it = x.item || {};
      if (x.kind === 'special') {
        return {
          id: d.id, kind: x.kind,
          minBid: Number(x.minBid||1),
          topBid: x.topBid || null,
          endsAt: x.endsAt, createdAt: x.createdAt,
          item_id: String(it.id||''),
          description: String(it.desc || it.desc_short || '')
        };
      }
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
  
    // [신규] 내가 등록한 경매 목록
  const auctionListMyListings = onCall({ region: 'us-central1' }, async (req) => {
      const uid = req.auth?.uid;
      _assert(uid, 'unauthenticated', '로그인이 필요해');
      const snap = await aucCol.where('seller_uid', '==', uid).orderBy('createdAt', 'desc').limit(50).get();
      const rows = snap.docs.map(d => {
          const x = d.data();
          const it = x.item || {};
          return {
              id: d.id,
              status: x.status,
              kind: x.kind,
              item_name: String(it.name || ''),
              item_rarity: String(it.rarity || 'normal'),
              minBid: Number(x.minBid || 1),
              topBid: x.topBid || null,
              createdAt: x.createdAt,
              endsAt: x.endsAt,
              soldAt: x.soldAt || null,
              buyer_uid: x.buyer_uid || null,
          };
      });
      return { ok: true, rows };
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

      _hold(tx, meRef, me, bid);

      if (A.topBid?.uid) {
        const prevRef = db.doc(`users/${A.topBid.uid}`);
        const prev = await tx.get(prevRef);
        if (prev.exists) _release(tx, prevRef, prev, Number(A.topBid.amount||0));
      }

      tx.update(ref, { topBid: { uid, amount: bid }, updatedAt: nowTs() });
      tx.set(ref.collection('bids').doc(), { uid, amount: bid, at: nowTs() });
    });

    return { ok:true };
  });

  const auctionSettle = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
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
        const winRef = db.doc(`users/${A.topBid.uid}`);
        const win = await tx.get(winRef);
        _assert(win.exists, 'not-found', '낙찰자 정보 없음');

        _capture(tx, winRef, win, Number(A.topBid.amount||0));
        _give(tx, sellerRef, Number(A.topBid.amount||0));
        _addItemToUser(tx, winRef, A.item);

        tx.update(ref, { status:'sold', buyer_uid: A.topBid.uid, soldAt: nowTs() });
      } else {
        _give(tx, sellerRef, 1);
        tx.update(ref, { status:'system_sold', buyer_uid:'__system__', soldAt: nowTs() });
      }
    });

    return { ok:true };
  });

  return {
    tradeCreateListing,
    tradeCancelListing,      // [신규]
    tradeGetListingDetail, // [신규]
    tradeListPublic,
    tradeListMyListings, // [신규]
    tradeBuy,
    auctionCreate,
    auctionListPublic,
    auctionListMyListings, // [신규]
    auctionBid,
    auctionSettle,
  };
};
