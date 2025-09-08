// /public/js/api/explore.js (탐험 전용 모듈)
import { db, auth, fx } from './firebase.js';
import { EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS, apply as applyCooldown } from './cooldown.js';

const STAMINA_BASE = 10;

export async function hasActiveRunForChar(charId){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const q = fx.query(
    fx.collection(db,'explore_runs'),
    fx.where('owner_uid','==', u.uid),
    fx.where('charRef','==', `chars/${charId}`),
    fx.where('status','==','ongoing'),
    fx.limit(1)
  );
  const s = await fx.getDocs(q);
  return !s.empty;
}

export function makePrerolls(n=50, mod=1000){
  return Array.from({length:n}, ()=> Math.floor(Math.random()*mod)+1);
}

export async function createRun({ world, site, char }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  // 동시에 한 캐릭 하나만
  if(await hasActiveRunForChar(char.id)){
    throw new Error('이미 진행 중인 탐험이 있어');
  }

  const payload = {
    charRef: `chars/${char.id}`,
    owner_uid: u.uid,
    world_id: world.id, world_name: world.name,
    site_id: site.id,   site_name: site.name,
    difficulty: site.difficulty || 'normal',
    startedAt: fx.serverTimestamp(),
    // 수정됨: expiresAt은 서버 타임스탬프 기준으로 계산하는 것이 더 안정적이므로 클라이언트에서 보내지 않음
    stamina_start: STAMINA_BASE,
    stamina: STAMINA_BASE,
    turn: 0,
    status: 'ongoing',
    summary3: '',
    prerolls: makePrerolls(50, 1000),
    events: [],
    rewards: []
  };

  // ===== 수정됨: writeBatch를 사용해 탐험 생성과 캐릭터 업데이트를 원자적으로 처리 =====
  const batch = fx.writeBatch(db);

  // 1. 새 탐험 런 문서 생성
  const runRef = fx.doc(fx.collection(db, 'explore_runs'));
  batch.set(runRef, payload);

  // 2. 캐릭터 문서에 마지막 탐험 시작 시간 기록
  const charRef = fx.doc(db, 'chars', char.id);
  batch.update(charRef, { last_explore_startedAt: fx.serverTimestamp() });

  // 배치 쓰기 실행
  await batch.commit();
  // ===================================================================

  // 로컬 쿨타임 적용 (UI/UX 목적)
  applyCooldown(EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS);

  return runRef.id;
}

export async function endRun({ runId, reason='ended' }){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const ref = fx.doc(db,'explore_runs', runId);
  const s = await fx.getDoc(ref);
  if(!s.exists()) throw new Error('런이 없어');
  const r = s.data();
  if(r.owner_uid !== u.uid) throw new Error('소유자가 아니야');
  if(r.status !== 'ongoing') return true;

  await fx.updateDoc(ref, {
    status: 'ended',
    endedAt: fx.serverTimestamp(), // Date.now() 대신 serverTimestamp 권장
    reason,
    updatedAt: fx.serverTimestamp()
  });
  return true;
}
