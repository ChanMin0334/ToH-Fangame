// /public/js/api/store.js
import { db, auth, fx, storage, sx, serverTimestamp } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { generateRelationNote } from './ai.js';
import { showToast } from '../ui/toast.js';

// ===== 전역 앱 상태 =====
export const App = {
  state: {
    user: null,
    worlds: null,
    currentWorldId: 'gionkir',
    myChars: []
  }
};

  // 썸네일 업로드 (교체본)
export async function uploadAvatarSquare(charId, file){
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');
  if (!charId || !file) throw new Error('charId, file 필요');

  // 원본 로드 및 리사이징 (기존과 동일)
  const buf = await file.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([buf]));
  const side = Math.min(bmp.width, bmp.height);
  const cropX = (bmp.width - side)/2, cropY = (bmp.height - side)/2;
  const toBlob = (cv, q)=> new Promise(res=> cv.toBlob(res, 'image/webp', q));

  // 1) 썸네일 256x256
  const ct = document.createElement('canvas'); ct.width=256; ct.height=256;
  ct.getContext('2d').drawImage(bmp, cropX, cropY, side, side, 0,0,256,256);
  let tq=0.9, tB=await toBlob(ct,tq); while(tB.size>150_000 && tq>0.4){ tq-=0.1; tB=await toBlob(ct,tq); }

  // 2) 원본(긴 변 1024)
  const scale = 1024/Math.max(bmp.width,bmp.height);
  const w = Math.round(bmp.width * Math.min(1, scale));
  const h = Math.round(bmp.height * Math.min(1, scale));
  const cm = document.createElement('canvas'); cm.width=w; cm.height=h;
  cm.getContext('2d').drawImage(bmp,0,0,w,h);
  let mq=0.9, mB=await toBlob(cm,mq); while(mB.size>950_000 && mq>0.4){ mq-=0.1; mB=await toBlob(cm,mq); }

  // --- ⏬ 여기가 핵심 변경 부분입니다 ⏬ ---

  // 3) Firebase Storage에 업로드할 경로 참조 생성
  // storage.rules에 정의된 경로와 일치시킵니다: /char_avatars/{uid}/{charId}/{fileName}
  const thumbRef = sx.ref(storage, `char_avatars/${u.uid}/${charId}/thumb_256.webp`);
  const mainRef  = sx.ref(storage, `char_avatars/${u.uid}/${charId}/main_1024.webp`);

  // 4) Blob 데이터를 Storage에 업로드
  const [thumbResult, mainResult] = await Promise.all([
    sx.uploadBytes(thumbRef, tB),
    sx.uploadBytes(mainRef, mB)
  ]);

  // 5) 업로드된 파일의 공개 URL 가져오기
  const [thumbUrl, mainUrl] = await Promise.all([
    sx.getDownloadURL(thumbResult.ref),
    sx.getDownloadURL(mainResult.ref)
  ]);

  // 6) Firestore에 URL 저장 (기존과 유사)
  await fx.updateDoc(fx.doc(db, 'chars', charId), {
    thumb_url: thumbUrl,
    updatedAt: Date.now()
  });

  const mainImagePayload = {
    url: mainUrl,
    w, h, mime: 'image/webp',
    owner_uid: u.uid,
    updatedAt: serverTimestamp()
  };
  await fx.setDoc(fx.doc(db, 'chars', charId, 'images', 'main'), mainImagePayload, { merge: true });

  showToast('아바타 업로드 완료 (Firebase Storage)');
  return { thumb_url: thumbUrl, main_url: mainUrl };
}

// 상세에서 큰 원본 URL 로드 (캐시 우선)
export async function getCharMainImageUrl(charId, {cacheFirst=true}={}){
  const ref = fx.doc(db,'chars',charId,'images','main');
  let snap;
  if(cacheFirst){ try{ snap = await fx.getDocFromCache(ref); }catch(e){} }
  if(!snap || !snap.exists()) snap = await fx.getDoc(ref);
  return snap.exists() ? (snap.data()?.url || '') : '';
}

// ===== 티어 계산 =====
export function tierOf(elo = 1000){
  if (elo < 1100)   return { name:'Bronze',   color:'#7a5a3a' };
  if (elo < 1300)  return { name:'Silver',   color:'#8aa0b8' };
  if (elo < 1500)  return { name:'Gold',     color:'#d1a43f' };
  if (elo < 1700)  return { name:'Platinum', color:'#69c0c6' };
  if (elo < 1900)  return { name:'Diamond',  color:'#7ec2ff' };
  return { name:'Master', color:'#b678ff' };
}

// ===== 세계관 로딩 =====
export async function fetchWorlds(){
  if (App.state.worlds) return App.state.worlds;
  const w = await fetch('/assets/worlds.json').then(r=>r.json());
  App.state.worlds = w;
  return w;
}

// ===== 내 캐릭 수 (최대 4개 제한 UX용) =====
export async function getMyCharCount(){
  const uid = auth.currentUser?.uid;
  if(!uid) return 0;
  const q = fx.query(
    fx.collection(db,'chars'),
    fx.where('owner_uid','==', uid),
    fx.limit(4)
  );
  const s = await fx.getDocs(q);
  return s.size;
}

// ===== 내 캐릭 목록 =====
export async function fetchMyChars(uid){
  const q = fx.query(fx.collection(db,'chars'), fx.where('owner_uid','==', uid));
  const s = await fx.getDocs(q);
  const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
  App.state.myChars = arr;
  return arr;
}

// ===== 최소 생성 =====
export async function createCharMinimal({ world_id, name, input_info }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const now = Date.now();
  const ref = await fx.addDoc(fx.collection(db,'chars'), {
    owner_uid: u.uid,
    world_id, name, input_info,
    image_url: '',
    abilities_all: [
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''}
    ],
    abilities_equipped: [0,1],
    items_equipped: [],
    narrative: '',
    summary: '',
    summary_line: '',
    elo: 1000, wins:0, losses:0, draws:0,
    likes_total:0, likes_weekly:0,
    battle_count:0, explore_count:0,
    createdAt: now, updatedAt: now
  });
  showToast('캐릭터가 생성되었어!');
  return ref.id;
}

// ===== 스킬/아이템 =====
export async function updateAbilitiesEquipped(charId, indices){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  const two = [...new Set((indices||[]).map(n=>+n))].slice(0,2);
  if(two.length !== 2) throw new Error('스킬은 정확히 2개여야 해');

  try{
    await fx.updateDoc(fx.doc(db,'chars',charId), { abilities_equipped: two, updatedAt: Date.now() });
  }catch(e){
    // 여기서 에러를 다시 던져서 호출부(토스트 처리)로 전달
    throw e;
  }
}


export async function updateItemsEquipped(charId, ids){
  const u = auth.currentUser; if(!u) return;
  const safe = (ids||[]).slice(0,3);
  await fx.updateDoc(fx.doc(db,'chars',charId), { items_equipped: safe, updatedAt: Date.now() });
  showToast('아이템 장착 변경');
}

// ===== 랭킹 로딩/캐시 =====
export let rankingsLoadedAt = 0;
App.rankings = null;

export async function loadRankingsFromServer(topN = 50){
  const col = fx.collection(db,'chars');
  const take = (field)=> fx.getDocs(fx.query(col, fx.orderBy(field,'desc'), fx.limit(topN)));
  const [w,t,e] = await Promise.all([ take('likes_weekly'), take('likes_total'), take('elo') ]);

  const toArr = (snap)=>{ const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()})); return arr; };
  App.rankings = { weekly: toArr(w), total: toArr(t), elo: toArr(e), fetchedAt: Date.now() };
  rankingsLoadedAt = App.rankings.fetchedAt;
  try{ localStorage.setItem('toh_rankings', JSON.stringify(App.rankings)); }catch{}
  return App.rankings;
}

export function restoreRankingCache(){
  try{
    const raw = localStorage.getItem('toh_rankings'); if(!raw) return null;
    const obj = JSON.parse(raw);
    if(obj?.weekly && obj?.total && obj?.elo){ App.rankings=obj; rankingsLoadedAt=obj.fetchedAt||0; return obj; }
  }catch{}
  return null;
}
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
export async function createOrUpdateRelation({ aCharId, bCharId, battleLogId }) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요해');

  // --- 0) ID 정규화: 'chars/{id}' 문자열로 강제 (규칙과 동일하게)
  const aRefStr = (typeof aCharId === 'string' && aCharId.startsWith('chars/')) ? aCharId : `chars/${aCharId}`;
  const bRefStr = (typeof bCharId === 'string' && bCharId.startsWith('chars/')) ? bCharId : `chars/${bCharId}`;

  // --- 1) 필요한 데이터 모두 읽기
  const [battleLog, charA, charB, existingRelationNote] = await Promise.all([
    getBattleLog(battleLogId),
    getCharForAI(aCharId),
    getCharForAI(bCharId),
    getRelationBetween(aCharId, bCharId)
  ]);

  // --- 2) AI로 관계 노트 생성/갱신
  const newNote = await generateRelationNote({
    battleLog,
    attacker: { name: charA.name, narrative: charA.latestLong },
    defender: { name: charB.name, narrative: charB.latestLong },
    existingNote: existingRelationNote
  });

  // --- 3) 관계 문서 ID (정렬 고정)
  const relId = [aCharId, bCharId].sort().join('__');
  const baseRef = fx.doc(db, 'relations', relId);
  const noteRef = fx.doc(db, 'relations', relId, 'meta', 'note');

  // --- 4) 디버그(한 번만 확인용)
  console.log('[REL-PATH]', `relations/${relId}`);
  console.log('[REL-FIELDS]', aRefStr, bRefStr);
  console.log('[REL-PAYLOAD:base]', {
    a_charRef: aRefStr, b_charRef: bRefStr, pair: [aCharId, bCharId].sort(),
    updatedAt: '<serverTimestamp>', lastBattleLogId: battleLogId
  });
  console.log('[REL-PAYLOAD:note]', { body: newNote, updatedAt: '<serverTimestamp>' });

  // --- 5) 쓰기 (규칙 호환: note → body, updatedBy 제거)
  const batch = fx.writeBatch(db);

  // 기본 관계 문서(없으면 생성, 있으면 병합)
  // --- 5) 쓰기 (배치 X) — 부모 먼저, 그 다음 노트
  await fx.setDoc(baseRef, {
    a_charRef: aRefStr,
    b_charRef: bRefStr,
    pair: [aCharId, bCharId].sort(), // 쿼리용
    updatedAt: fx.serverTimestamp(),
    lastBattleLogId: battleLogId
  }, { merge: true });

  // /relations/{id}/meta/note 는 규칙상 body, updatedAt만 허용
  await fx.setDoc(noteRef, {
    body: newNote,
    updatedAt: fx.serverTimestamp()
  }, { merge: true });


  await batch.commit();
  return { relationId: relId, note: newNote };
}



// deleteRelation 함수를 아래 내용으로 교체합니다.
export async function deleteRelation(charId1, charId2){
  const uid = auth.currentUser?.uid;
  if(!uid) throw new Error('로그인이 필요해');

  const relId = [charId1, charId2].sort().join('__');
  const noteRef = fx.doc(db, 'relations', relId, 'meta', 'note');
  const baseRef = fx.doc(db, 'relations', relId);

  // 하위 문서를 먼저 삭제 후, 주 문서를 삭제
  await fx.deleteDoc(noteRef).catch(()=>{}); // 노트가 없을 수도 있으니 에러는 무시
  await fx.deleteDoc(baseRef);
  
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

// ===== Battle Log Utils =====
export async function saveBattleLog({ attackerId, defenderId, winner, stepsHtml, startedAtMs, endedAtMs }) {
  const attackerRef = `chars/${attackerId}`;
  const defenderRef = `chars/${defenderId}`;

  // 소유자 조회
  const [aSnap, dSnap] = await Promise.all([
    fx.getDoc(fx.doc(db, attackerRef)),
    fx.getDoc(fx.doc(db, defenderRef))
  ]);
  if (!aSnap.exists() || !dSnap.exists()) throw new Error('캐릭터 조회 실패');
  const a = aSnap.data(), d = dSnap.data();

  const docRef = await fx.addDoc(fx.collection(db, 'battle_logs'), {
    attacker_char: attackerRef,
    defender_char: defenderRef,
    attacker_owner_uid: a.owner_uid,
    defender_owner_uid: d.owner_uid,
    winner, // 'attacker' | 'defender' | 'draw'
    steps_html: String(stepsHtml || ''),
    startedAt: startedAtMs ? new Date(startedAtMs) : fx.serverTimestamp(),
    endedAt: endedAtMs ? new Date(endedAtMs) : fx.serverTimestamp(),
    createdBy: auth.currentUser?.uid || a.owner_uid || d.owner_uid
    // relation_deadline: functions가 세팅
  });
  return docRef.id;
}

export async function getBattleLog(logId){
  const s = await fx.getDoc(fx.doc(db, 'battle_logs', logId));
  if(!s.exists()) throw new Error('배틀 로그 없음');
  return { id: s.id, ...s.data() };
}

// === [탐험 콜러블 래퍼] ===
export async function startExploreServer({ charId, worldId, siteId, difficulty='normal' }){
  const call = httpsCallable(func, 'startExplore');
  const { data } = await call({ charId, worldId, siteId, difficulty });
  return data;
}
export async function stepExploreServer({ runId, choiceKey=null }){
  const call = httpsCallable(func, 'stepExplore');
  const { data } = await call({ runId, choiceKey });
  return data;
}
export async function endExploreServer({ runId }){
  const call = httpsCallable(func, 'endExplore');
  const { data } = await call({ runId });
  return data;
}


// === 레거시 호환: saveLocal 참조하는 오래된 파일 대비 (no-op) ===
export function saveLocal(){ /* noop */ }


/* === ADVENTURE: getCharForAI (얕은 조회) ===
 * charRef 문자열("chars/{cid}") 또는 캐릭터 id를 받아
 * 이름, 최신 서사, 스킬(장착 2칸 기준), 전체 스킬 배열을 돌려준다.
 */
export async function getCharForAI(charRefOrId){
  const refStr = String(charRefOrId||'');
  const cid = refStr.startsWith('chars/') ? refStr.split('/')[1] : refStr;
  if(!cid) return null;

  const ref = fx.doc(db, 'chars', cid);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) return null;

  const c = snap.data() || {};
  const latest = Array.isArray(c.narratives)
    ? [...c.narratives].sort((a,b)=>(b?.createdAt||0)-(a?.createdAt||0))[0]
    : null;

  const equippedIdx = Array.isArray(c.abilities_equipped) ? c.abilities_equipped.slice(0,2) : [];
  const all = Array.isArray(c.abilities_all) ? c.abilities_all : [];
  const skills = equippedIdx.map(i => {
    const ab = all[i] || {};
    return { name: ab.name || `스킬${(i??0)+1}`, desc: ab.desc_soft || '' };
  });

  return {
    id: cid,
    name: c.name || '(이름 없음)',
    latestLong: latest?.long || '',
    shortConcat: Array.isArray(c.narratives) ? c.narratives.map(n=>n?.short||'').join(' / ') : '',
    skills,            // 장착 2칸을 즉시 해석한 결과
    _raw: c            // 필요 시 참조용(프롬프트엔 쓰지 말 것)
  };
}

// ◀◀◀ 여기에 새 함수를 추가하세요.
export async function likeChar(charId) {
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');
  if (!charId) throw new Error('캐릭터 ID가 필요해');

  const charRef = fx.doc(db, 'chars', charId);

  // Firestore의 increment를 사용하여 안전하게 카운트 증가
  await fx.updateDoc(charRef, {
    likes_total: fx.increment(1),
    likes_weekly: fx.increment(1),
    updatedAt: Date.now()
  });

  return true;
}

// /public/js/api/store.js 파일 맨 아래에 추가

export async function getRelationBetween(charId1, charId2) {
  if (!charId1 || !charId2) return null;
  const sortedIds = [charId1, charId2].sort();
  const relationId = `${sortedIds[0]}__${sortedIds[1]}`;
  
  try {
    // char.js의 더미 데이터처럼 관계에 대한 상세 메모가 있는지 먼저 확인
    const relRef = fx.doc(db, 'relations', relationId, 'meta', 'note');
    const relSnap = await fx.getDoc(relRef);
    if (relSnap.exists()) {
      return relSnap.data().note || '알려지지 않은 관계';
    }
    
    // 상세 메모가 없다면, 관계 문서 자체가 존재하는지만 확인
    const baseRelRef = fx.doc(db, 'relations', relationId);
    const baseRelSnap = await fx.getDoc(baseRelRef);
    return baseRelSnap.exists() ? '일반 관계' : null;

  } catch (e) {
    console.warn(`[getRelationBetween] failed for ${relationId}`, e);
    return null;
  }
}
