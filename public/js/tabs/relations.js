// ===== Economy Limits =====
async function fetchLimits(){
  try{
    const s = await fx.getDoc(fx.doc(db,'economy','limits'));
    if(s.exists()) return s.data();
  }catch{}
  // 기본값 (형원 설정 전)
  return {
    battle_min: 5,  battle_max: 40,
    encounter_min: 3, encounter_max: 20,
    explore_min: 2, explore_max: 30,
    daily_cap: 200
  };
}

export async function grantExp(charId, base, mode, note=''){
  const lim = await fetchLimits();
  const clamp = (x,min,max)=>Math.max(min, Math.min(max, x));
  const per = ({battle:[lim.battle_min, lim.battle_max], encounter:[lim.encounter_min, lim.encounter_max], explore:[lim.explore_min, lim.explore_max]})[mode] || [1,10];
  const delta = clamp(Math.round(base), per[0], per[1]);

  const ref = fx.doc(db,'chars',charId);
  const snap = await fx.getDoc(ref); if(!snap.exists()) throw new Error('캐릭터 없음');
  const c = snap.data();

  // 일일 캡: 간단히 today bucket field 사용
  const today = new Date(); const dKey = today.toISOString().slice(0,10); // YYYY-MM-DD
  const bucket = (c.exp_daily && c.exp_daily[dKey]) || 0;
  const space = Math.max(0, (lim.daily_cap||0) - bucket);
  const add = Math.min(space, delta);
  if(add <= 0) return { ok:true, added:0, capped:true };

  const inc = {};
  inc[`exp_daily.${dKey}`] = (bucket + add);
  await fx.updateDoc(ref, {
    exp: (c.exp||0) + add,
    exp_progress: ((c.exp_progress||0) + add) % 100,
    updatedAt: Date.now(),
    ...inc
  });

  // 간단 로그 (선택)
  await fx.addDoc(fx.collection(db,'exp_logs'), {
    char_id: `chars/${charId}`, mode, add, base, note, at: Date.now(), owner_uid: c.owner_uid
  });

  return { ok:true, added: add };
}

// ===== Relations / Episodes helpers =====
export async function createRelation({ aCharId, bCharId, note='' }){
  const uid = auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const relId = [aCharId, bCharId].sort().join('__');
  const ref = fx.doc(db, 'relations', relId);
  await fx.setDoc(ref, {
    a_charRef: `chars/${aCharId}`,
    b_charRef: `chars/${bCharId}`,
    createdBy: uid,
    createdAt: Date.now()
  }, { merge: false });
  if(note) await fx.setDoc(fx.doc(db,'relations', relId, 'meta', 'note'), { note, updatedAt: Date.now(), owner_uid: uid }, { merge: true });
  return relId;
}

export async function deleteRelation(relId){
  const uid = auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  await fx.deleteDoc(fx.doc(db,'relations', relId));
  return true;
}

// 하루 1개 미니에피소드 생성 (docId=YYYY-MM-DD)
export async function createDailyEpisode(relId, payload){
  const today = new Date().toISOString().slice(0,10);
  const ref = fx.doc(db, 'relation_daily', relId, 'episodes', today);
  await fx.setDoc(ref, { ...payload, owner_uid: auth.currentUser.uid, createdAt: Date.now() }, { merge: false });
  return today;
}

// 서사 융합: 최신 서사 long 뒤에 단락 추가 + short 재요약
export async function mergeMiniEpisodeIntoLatestNarrative(charId, episodeText){
  const cRef = fx.doc(db,'chars',charId);
  const s = await fx.getDoc(cRef); if(!s.exists()) throw new Error('캐릭터 없음');
  const c = s.data();

  let arr = Array.isArray(c.narratives) ? c.narratives.slice() : [];
  if(arr.length === 0){
    arr = [{ id: 'n'+Math.random().toString(36).slice(2), title:'서사', long: episodeText, short: episodeText.slice(0,120)+'…', createdAt: Date.now() }];
  }else{
    // 최신 1개만 메인 취급: createdAt 기준 정렬 가정, 없으면 마지막 원소
    arr.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const latest = arr[0];
    latest.long = (latest.long||'') + '\n\n' + episodeText;
    latest.short = (latest.long||'').slice(0, 120) + '…';
    latest.updatedAt = Date.now();
  }

  await fx.updateDoc(cRef, { narratives: arr, narrative_latest_id: arr[0].id, updatedAt: Date.now() });
  return true;
}
