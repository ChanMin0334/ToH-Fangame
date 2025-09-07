// /public/js/api/match_client.js
// 클라이언트 임시 매칭: Firestore "읽기"만으로 근접 Elo 후보 뽑기
// 서버 세션 저장은 하지 않음(시작 버튼은 더미)

export async function autoMatch({ db, fx, charId, mode }){
  try{
    if(!charId) return { ok:false };

    const id = String(charId).replace(/^chars\//,'');
    const meSnap = await fx.getDoc(fx.doc(db,'chars', id));
    if(!meSnap.exists()) return { ok:false };

    const me = meSnap.data();
    const myUid = me.owner_uid;
    const myElo = me.elo ?? 1000;

    // 내 것 제외 + 유효한 문서만
    const filterValid = (docs)=>docs
      .map(d=>({ id:d.id, ...d.data() }))
      .filter(x=> x.owner_uid && x.owner_uid!==myUid && x.name && (x.summary||x.intro));

    // Elo 위쪽 10명
    const qUp = fx.query(
      fx.collection(db,'chars'),
      fx.where('elo','>=', myElo),
      fx.orderBy('elo','asc'),
      fx.limit(10)
    );
    // Elo 아래쪽 10명
    const qDown = fx.query(
      fx.collection(db,'chars'),
      fx.where('elo','<=', myElo),
      fx.orderBy('elo','desc'),
      fx.limit(10)
    );

    const [upSnap, downSnap] = await Promise.all([fx.getDocs(qUp), fx.getDocs(qDown)]);
    const candsRaw = [...filterValid(upSnap.docs), ...filterValid(downSnap.docs)];
    const cands = [];
    const seen = new Set([id]);
    for(const c of candsRaw){
      if(seen.has(c.id)) continue;
      seen.add(c.id);
      cands.push(c);
    }
    if(cands.length===0) return { ok:false };

    // 가중치 선택: e = Elo 차이, w = ceil(200/(1+e)+1)
    const bag=[];
    for(const c of cands){
      const e = Math.abs((c.elo ?? 1000) - myElo);
      const w = Math.max(1, Math.ceil(200/(1+e)+1));
      for(let i=0;i<w;i++) bag.push(c);
    }
    if(bag.length===0) return { ok:false };

    const opp = bag[Math.floor(Math.random()*bag.length)];
    return {
      ok: true,
      opponent: {
        id: opp.id,
        name: opp.name,
        thumb_url: opp.thumb_url || opp.image_url || '',
        elo: opp.elo ?? 1000
      },
      token: null  // 클라 임시 매칭이라 세션 토큰 없음
    };
  }catch(e){
    console.error('[autoMatch]', e);
    return { ok:false, error: e?.message || String(e) };
  }
}
