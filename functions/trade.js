// functions/trade.js (FULL, patched)
// - 입찰 최소가 검증 명시화
// - 희귀도 정규화(unique→epic, uncommon→rare)
// - 장착 해제 로직 보강(문자/숫자 id 혼재 대비)
// - 보증금 hold/release 증감 연산 통일
// - 특수경매 공개시 스펙 노출 금지

module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();

  // ---------- utils ----------
  const nowTs = () => admin.firestore.Timestamp.now();
  const dayStamp = (d = new Date()) => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).toString().padStart(2,'0'), dd = String(d.getDate()).toString().padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  function _assert(cond, code, msg) { if (!cond) throw new HttpsError(code, msg); }

  function _normalizeRarity(raw) {
    const r = String(raw||'normal').toLowerCase();
    if (r === 'unique') return 'epic';
    if (r === 'uncommon') return 'rare';
    return r;
  }

  function _calculatePrice(item) {
    const prices = {
      consumable:     { normal: 1,  rare: 5,  epic: 25,  legend: 50,  myth: 100, aether: 250 },
      non_consumable: { normal: 2,  rare:10,  epic: 50,  legend:100,  myth: 200, aether: 500 }
    };
    const isConsumable = item.isConsumable || item.consumable || item.consume;
    const tier = isConsumable ? prices.consumable : prices.non_consumable;
    const rarity = _normalizeRarity(item.rarity);
    return tier[rarity] || 0;
  }

  // ---------- inventory helpers ----------
  async function _removeItemFromUser(tx, userRef, userSnap, itemId, uid) {
    const items = Array.isArray(userSnap.get('items_all')) ? [...userSnap.get('items_all')] : [];
    const idx = items.findIndex(it => String(it?.id) === String(itemId));
    _assert(idx >= 0, 'failed-precondition', '인벤토리에 해당 아이템이 없어');
    const [item] = items.splice(idx, 1);
    tx.update(userRef, { items_all: items });

    // 이 아이템이 장착돼 있으면 모든 내 캐릭에서 해제
    const charsRef = db.collection('chars');
    // 1차: array-contains (문자 케이스)
    const q1 = charsRef.where('owner_uid','==',uid).where('items_equipped','array-contains', String(itemId));
    const snaps1 = await tx.get(q1);
    const touched = new Set();
    snaps1.forEach(doc => { touched.add(doc.id);
      const ch = doc.data();
      const ne = (ch.items_equipped||[]).filter(v => String(v) !== String(itemId));
      tx.update(doc.ref, { items_equipped: ne });
    });
    // 2차: 숫자 id로 저장된 레거시 대비
    const allMine = await tx.get(charsRef.where('owner_uid','==',uid));
    allMine.docs.forEach(doc => {
      if (touched.has(doc.id)) return;
      const ch = doc.data();
      const arr = ch.items_equipped || [];
      if (arr.some(v => String(v) === String(itemId))) {
        const ne = arr.filter(v => String(v) !== String(itemId));
        tx.update(doc.ref, { items_equipped: ne });
      }
    });
    return item;
  }

  function _addItemToUser(tx, userRef, itemObj) {
    const FieldValue = admin.firestore.FieldValue;
    tx.set(userRef, { items_all: FieldValue.arrayUnion(itemObj) }, { merge: true });
  }

  // ---------- coins helpers ----------
  function _pay(tx, userRef, userSnap, amount) {
    const coins = Number(userSnap.get('coins')||0);
    const p = Math.max(0, Math.floor(Number(amount||0)));
    _assert(coins >= p, 'failed-precondition', '골드가 부족해');
    tx.update(userRef, { coins: coins - p });
  }

  function _refund(tx, userRef, userSnap, amount) {
    const p = Math.max(0, Math.floor(Number(amount||0)));
    const FieldValue = admin.firestore.FieldValue;
    tx.update(userRef, { coins: FieldValue.increment(p) });
  }

  function _hold(tx, userRef, userSnap, amount) {
    const want = Math.max(0, Math.floor(Number(amount||0)));
    const coins = Number(userSnap.get('coins')||0);
    _assert(coins >= want, 'failed-precondition', '골드가 부족해(입찰 보증금)');
    const FieldValue = admin.firestore.FieldValue;
    tx.update(userRef, { coins: FieldValue.increment(-want), coins_hold: FieldValue.increment(+want) });
  }

  function _release(tx, userRef, userSnap, amount) {
    const want = Math.max(0, Math.floor(Number(amount||0)));
    if (want === 0) return;
    const curHold = Number(userSnap.get('coins_hold')||0);
    _assert(curHold >= want, 'internal', '보증금 환불 불가 (데이터 불일치)');
    const FieldValue = admin.firestore.FieldValue;
    tx.update(userRef, { coins: FieldValue.increment(+want), coins_hold: FieldValue.increment(-want) });
  }

  function _capture(tx, userRef, userSnap, amount) {
    const want = Math.max(0, Math.floor(Number(amount||0)));
    const curHold = Number(userSnap.get('coins_hold')||0);
    _assert(curHold >= want, 'internal', '보증금 확정 불가');
    const FieldValue = admin.firestore.FieldValue;
    tx.update(userRef, { coins_hold: FieldValue.increment(-want) });
  }

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

  // ---------- [일반거래] ----------
  const tradeCol = db.collection('market_trades');

  const tradeCreateListing = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { itemId, price } = req.data || {};
    _assert(itemId && Number.isFinite(Number(price)), 'invalid-argument', '잘못된 입력');

    const userRef = db.doc(`users/${uid}`);
    const listingRef = tradeCol.doc();

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');

      _bumpDailyTradeCount(tx, userRef, userSnap);
      const item = await _removeItemFromUser(tx, userRef, userSnap, String(itemId), uid);

      const basePrice = _calculatePrice(item);
      _assert(basePrice > 0, 'invalid-argument', '가격을 산정할 수 없는 아이템이야');
      const minPrice = Math.floor(basePrice * 0.5);
      const maxPrice = Math.floor(basePrice * 1.5);
      const p = Math.floor(Number(price));
      _assert(p >= minPrice && p <= maxPrice, 'failed-precondition', `가격은 ${minPrice}~${maxPrice} 골드 사이만 가능해`);

      tx.set(listingRef, {
        status: 'active',
        seller_uid: uid,
        price: p,
        item,
        createdAt: nowTs()
      });
    });

    return { ok: true, id: listingRef.id };
  });

  const tradeCancelListing = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');

    const listingRef = tradeCol.doc(String(listingId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(listingRef);
      _assert(snap.exists, 'not-found', '판매 물품을 찾을 수 없어');
      const row = snap.data();
      _assert(row.seller_uid === uid, 'permission-denied', '내 물건만 취소할 수 있어');
      _assert(row.status === 'active', 'failed-precondition', '이미 판매되었거나 취소된 물품이야');

      const userRef = db.doc(`users/${uid}`);
      _addItemToUser(tx, userRef, row.item);
      tx.update(listingRef, { status: 'cancelled', cancelledAt: nowTs() });
    });
    return { ok: true };
  });

  const tradeBuy = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');

    const ref = tradeCol.doc(String(listingId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '판매 물품을 찾을 수 없어');
      const row = snap.data();
      _assert(row.status === 'active', 'failed-precondition', '이미 판매되었거나 취소된 물품이야');
      _assert(row.seller_uid !== uid, 'failed-precondition', '내 물건은 내가 못 사');

      const buyerRef = db.doc(`users/${uid}`);
      const sellerRef = db.doc(`users/${row.seller_uid}`);

      const buyer = await tx.get(buyerRef);
      const seller = await tx.get(sellerRef);
      _assert(buyer.exists && seller.exists, 'not-found', '유저 정보 부족');

      _pay(tx, buyerRef, buyer, Number(row.price||0));
      _refund(tx, sellerRef, seller, Number(row.price||0));
      _addItemToUser(tx, buyerRef, row.item);
      tx.update(ref, { status: 'sold', buyer_uid: uid, soldAt: nowTs() });
    });

    return { ok: true };
  });

  const tradeGetListingDetail = onCall({ region:'us-central1' }, async (req) => {
    const { listingId } = req.data || {};
    _assert(listingId, 'invalid-argument', 'listingId 필요');
    const snap = await tradeCol.doc(String(listingId)).get();
    _assert(snap.exists, 'not-found', '판매 없음');
    const x = snap.data();
    const it = x.item || {};
    return {
      ok: true,
      id: snap.id,
      price: Number(x.price||0),
      item: it,
      seller_uid: x.seller_uid || null,
      createdAt: x.createdAt || null,
    };
  });

  const tradeListPublic = onCall({ region:'us-central1' }, async (req) => {
    const snap = await tradeCol.where('status','==','active').orderBy('createdAt','desc').limit(120).get();
    const rows = snap.docs.map(d => {
      const x = d.data(), it = x.item || {};
      return {
        id: d.id,
        status: x.status,
        price: Number(x.price||0),
        item_name: String(it.name||''),
        item_rarity: String(_normalizeRarity(it.rarity||'normal')),
        createdAt: x.createdAt,
        soldAt: x.soldAt || null,
        buyer_uid: x.buyer_uid || null,
      };
    });
    return { ok: true, rows };
  });

  const tradeListMyListings = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const snap = await tradeCol.where('seller_uid','==',uid).orderBy('createdAt','desc').limit(50).get();
    const rows = snap.docs.map(d => {
      const x = d.data(), it = x.item || {};
      return {
        id: d.id,
        status: x.status,
        price: Number(x.price||0),
        item_name: String(it.name||''),
        item_rarity: String(_normalizeRarity(it.rarity||'normal')),
        createdAt: x.createdAt,
        soldAt: x.soldAt || null,
        buyer_uid: x.buyer_uid || null,
      };
    });
    return { ok: true, rows };
  });

  // ---------- [경매] ----------
  const aucCol = db.collection('market_auctions');
  const MIN_MINUTES = 30;
  const MIN_STEP = 1;

  const auctionCreate = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { itemId, kind, minBid, minutes } = req.data || {};
    _assert(itemId && Number.isFinite(Number(minBid)), 'invalid-argument', '잘못된 입력');
    const k = (kind === 'special') ? 'special' : 'normal';
    const durMin = Math.max(MIN_MINUTES, Math.floor(Number(minutes||MIN_MINUTES)));

    const userRef = db.doc(`users/${uid}`);
    const aucRef = aucCol.doc();
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      _assert(userSnap.exists, 'not-found', '유저 없음');

      const item = await _removeItemFromUser(tx, userRef, userSnap, String(itemId), uid);

      const endsAt = admin.firestore.Timestamp.fromMillis(Date.now() + durMin*60*1000);
      tx.set(aucRef, {
        status:'active', kind: k,
        seller_uid: uid,
        item,
        minBid: Math.max(1, Math.floor(Number(minBid||1))),
        topBid: null,
        createdAt: nowTs(),
        endsAt,
      });
    });
    return { ok:true, id: aucRef.id };
  });

  const auctionGetDetail = onCall({ region:'us-central1' }, async (req) => {
    const { auctionId } = req.data || {};
    _assert(auctionId, 'invalid-argument', 'auctionId 필요');
    const snap = await aucCol.doc(String(auctionId)).get();
    _assert(snap.exists, 'not-found', '경매 없음');
    const A = snap.data();
    if ((A.kind||'normal') === 'special') return { ok:true, kind:'special' };
    const it = A.item || {};
    return {
      ok:true,
      id: snap.id,
      kind: A.kind || 'normal',
      item_name: String(it.name||''),
      item_rarity: String(_normalizeRarity(it.rarity||'normal')),
      minBid: Number(A.minBid||1),
      topBid: A.topBid || null,
      createdAt: A.createdAt,
      endsAt: A.endsAt,
    };
  });

  const auctionListPublic = onCall({ region:'us-central1' }, async (req) => {
    const kindReq = req.data?.kind;
    let q = aucCol.where('status','==','active');
    if (kindReq === 'special') q = q.where('kind','==','special');
    else if (kindReq === 'normal') q = q.where('kind','in',['normal', null]);

    const snap = await q.orderBy('createdAt','desc').limit(120).get();
    const rows = snap.docs.map(d => {
      const x = d.data(); const it = x.item || {};
      const base = {
        id: d.id,
        kind: x.kind || 'normal',
        minBid: Number(x.minBid||1),
        topBid: x.topBid || null,
        endsAt: x.endsAt, createdAt: x.createdAt,
        item_id: String(it.id||''),
        consumable: it.consumable || it.isConsumable || false,
        uses: it.uses || null
      };
      if (base.kind === 'special') {
        return {
          ...base,
          description: String(it.description || it.desc_long || it.desc || '')
        };
      }
      return {
        ...base,
        item_name: String(it.name||''),
        item_rarity: String(_normalizeRarity(it.rarity||'normal'))
      };
    });
    return { ok:true, rows };
  });

  const auctionListMyListings = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const snap = await aucCol.where('seller_uid','==',uid).orderBy('createdAt','desc').limit(50).get();
    const rows = snap.docs.map(d => {
      const x = d.data(); const it = x.item || {};
      return {
        id: d.id,
        status: x.status,
        kind: x.kind,
        item_name: String(it.name||''),
        item_rarity: String(_normalizeRarity(it.rarity||'normal')),
        minBid: Number(x.minBid||1),
        topBid: x.topBid || null,
        createdAt: x.createdAt,
        endsAt: x.endsAt,
        soldAt: x.soldAt || null,
        buyer_uid: x.buyer_uid || null,
      };
    });
    return { ok:true, rows };
  });

  const auctionListMyBids = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const snap = await aucCol.where('status','==','active').orderBy('createdAt','desc').limit(200).get();
    const rows = snap.docs.map(d => {
      const x = d.data();
      const mine = (x.topBid?.uid === uid);
      if (!mine) return null;
      const it = x.item || {};
      return {
        id: d.id,
        status: x.status,
        kind: x.kind || 'normal',
        myBid: x.topBid?.amount || null,
        item_name: (x.kind==='special') ? '' : String(it.name||''),
        item_rarity: (x.kind==='special') ? '' : String(_normalizeRarity(it.rarity||'normal')),
        createdAt: x.createdAt, endsAt: x.endsAt
      };
    }).filter(Boolean);
    return { ok:true, rows };
  });

  const auctionBid = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { auctionId, amount } = req.data || {};
    _assert(auctionId && Number.isFinite(Number(amount)), 'invalid-argument', '잘못된 입력');

    const ref = aucCol.doc(String(auctionId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '경매 없음');
      const A = snap.data();
      _assert(A.status==='active', 'failed-precondition', '종료된 경매야');
      _assert(A.seller_uid !== uid, 'failed-precondition', '내 경매엔 입찰 불가');
      _assert(A.endsAt?.toMillis() > Date.now(), 'failed-precondition', '이미 마감됨');

      const bid = Math.floor(Number(amount));
      const prev = A.topBid || null;
      const minOk = Math.max(Number(A.minBid||1), (prev?.amount||0) + 1);
      _assert(bid >= minOk, 'failed-precondition', `입찰가는 최소 ${minOk} 이상이어야 해`);

      const meRef = db.doc(`users/${uid}`);
      const me = await tx.get(meRef);
      _assert(me.exists, 'not-found', '유저 없음');

      if (prev?.uid && prev.uid === uid) {
        const delta = bid - Number(prev.amount||0);
        _assert(delta >= 1, 'failed-precondition', '이전 입찰보다 높아야 해');
        _hold(tx, meRef, me, delta);
      } else {
        _hold(tx, meRef, me, bid);
        if (prev?.uid) {
          const prevRef = db.doc(`users/${prev.uid}`);
          const prevSnap = await tx.get(prevRef);
          if (prevSnap.exists) _release(tx, prevRef, prevSnap, Number(prev.amount||0));
        }
      }

      tx.update(ref, { topBid: { uid, amount: bid }, updatedAt: nowTs() });
      tx.set(ref.collection('bids').doc(), { uid, amount: bid, at: nowTs() });

      if (prev?.uid && prev.uid !== uid) {
        const mailRef = db.collection('mail').doc(prev.uid).collection('msgs').doc();
        tx.set(mailRef, {
          kind: 'notice',
          title: '경매 입찰 알림',
          body: `참여 중인 경매가 다른 입찰로 갱신되었습니다. 경매: ${ref.id}`,
          sentAt: nowTs(), read: false, from: 'system',
          attachments: { coins:0, items:[], ticket:null },
          claimed: false
        });
      }
    });

    return { ok:true };
  });

  const auctionSettle = onCall({ region:'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    _assert(uid, 'unauthenticated', '로그인이 필요해');
    const { auctionId } = req.data || {};
    _assert(auctionId, 'invalid-argument', 'auctionId 필요');

    const ref = aucCol.doc(String(auctionId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      _assert(snap.exists, 'not-found', '경매 없음');
      const A = snap.data();
      _assert(A.seller_uid === uid, 'permission-denied', '판매자만 확정 가능');
      _assert(A.status === 'active', 'failed-precondition', '이미 처리됨');
      _assert(A.endsAt?.toMillis() <= Date.now(), 'failed-precondition', '아직 마감 전이야');

      const top = A.topBid;
      const sellerRef = db.doc(`users/${uid}`);
      const seller = await tx.get(sellerRef);
      _assert(seller.exists, 'not-found', '판매자 없음');

      if (!top || !top.uid) {
        // 유찰: 아이템 반환
        _addItemToUser(tx, sellerRef, A.item);
        tx.update(ref, { status:'expired', updatedAt: nowTs() });
        return;
      }
      const buyerRef = db.doc(`users/${top.uid}`);
      const buyer = await tx.get(buyerRef);
      _assert(buyer.exists, 'not-found', '구매자 없음');

      _capture(tx, buyerRef, buyer, Number(top.amount||0));
      _refund(tx, sellerRef, seller, Number(top.amount||0));
      _addItemToUser(tx, buyerRef, A.item);
      tx.update(ref, { status:'sold', buyer_uid: top.uid, soldAt: nowTs() });
    });

    return { ok:true };
  });

  return {
    tradeCreateListing,
    tradeCancelListing,
    tradeGetListingDetail,
    tradeListPublic,
    tradeListMyListings,
    tradeBuy,
    auctionCreate,
    auctionGetDetail,
    auctionListPublic,
    auctionListMyListings,
    auctionBid,
    auctionSettle,
    auctionListMyBids,
  };
};
