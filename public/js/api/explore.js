// /public/js/api/explore.js (탐험 전용 모듈)
import { db, auth, fx } from './firebase.js';
// writeBatch를 firestore에서 직접 import합니다.
import { writeBatch, doc, collection } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS, apply as applyCooldown } from './cooldown.js';

const STAMINA_BASE = 10;

// === EXPLORE: dice tables (기존과 동일) ===
const EVENT_TABLE = {
  easy:   { safe:400, item:250, narrative:200, risk:100, combat:50 },
  normal: { safe:300, item:200, narrative:200, risk:150, combat:150 },
  hard:   { safe:220, item:180, narrative:180, risk:220, combat:200 },
  vhard:  { safe:150, item:150, narrative:150, risk:250, combat:300 },
  legend: { safe:100, item:120, narrative:130, risk:250, combat:400 },
};
const RARITY_TABLE = [
  { upto:500,  rarity:'normal' },
  { upto:800,  rarity:'rare'   },
  { upto:930,  rarity:'epic'   },
  { upto:980,  rarity:'legend' },
  { upto:1000, rarity:'myth'   },
];
const COMBAT_TIER = {
  easy:   [{p:600,t:'trash'},{p:950,t:'normal'},{p:1000,t:'elite'}],
  normal: [{p:350,t:'trash'},{p:900,t:'normal'},{p:980,t:'elite'},{p:1000,t:'boss'}],
  hard:   [{p:220,t:'trash'},{p:700,t:'normal'},{p:950,t:'elite'},{p:1000,t:'boss'}],
  vhard:  [{p:150,t:'trash'},{p:550,t:'normal'},{p:900,t:'elite'},{p:1000,t:'boss'}],
  legend: [{p:80, t:'trash'},{p:380,t:'normal'},{p:800,t:'elite'},{p:1000,t:'boss'}],
};
function popRoll(run, mod=1000){
  const arr = Array.isArray(run.prerolls) ? run.prerolls.slice() : [];
  const v = arr.length ? arr.shift() : (Math.floor(Math.random()*mod)+1);
  return { value: ((v-1)%mod)+1, next: arr };
}

// (기존과 동일)
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

// (기존과 동일)
export function makePrerrolls(n=50, mod=1000){
  return Array.from({length:n}, ()=> Math.floor(Math.random()*mod)+1);
}

// ===== ⚠️ 수정된 부분: createRun 함수 =====
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
    stamina_start: STAMINA_BASE,
    stamina: STAMINA_BASE,
    turn: 0,
    status: 'ongoing',
    summary3: '',
    prerolls: makePrerolls(50, 1000),
    events: [],
    rewards: []
  };

  // --- 원자적 쓰기를 위해 writeBatch 사용 ---
  const batch = writeBatch(db);

  // 1. 새 탐험 문서에 대한 참조 생성
  const runRef = doc(collection(db, 'explore_runs'));
  batch.set(runRef, payload);

  // 2. 캐릭터 문서에 대한 참조 생성 및 마지막 탐험 시간 업데이트
  const charRef = doc(db, 'chars', char.id);
  batch.update(charRef, { last_explore_startedAt: fx.serverTimestamp() });

  try {
    // 3. batch를 한 번에 커밋 (두 작업이 모두 성공하거나 모두 실패)
    await batch.commit();
  } catch (e) {
    console.error('[explore] createRun batch fail', e);
    // permission-denied 에러는 대부분 쿨타임 규칙 때문일 가능성이 높습니다.
    if (e.code === 'permission-denied') {
      throw new Error('탐험 시작 실패 (서버 쿨타임 또는 규칙 위반)');
    }
    // 그 외 다른 에러
    throw new Error('탐험 문서 생성에 실패했어');
  }

  // 로컬 쿨타임 적용 (UI/UX 목적)
  applyCooldown(EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS);

  return runRef.id;
}
// ===== 수정 끝 =====

// (이하 나머지 코드는 기존과 동일)
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
    endedAt: fx.serverTimestamp(),
    reason,
    updatedAt: fx.serverTimestamp()
  });
  return true;
}

export async function getActiveRun(runId){
  const ref = fx.doc(db,'explore_runs', runId);
  const s = await fx.getDoc(ref);
  if(!s.exists()) throw new Error('런이 없어');
  return { id:s.id, ...s.data() };
}

export function rollStep(run){
  const diff = (run?.difficulty||'normal');
  const eRoll = popRoll(run, 1000); run.prerolls = eRoll.next;
  let acc=0, kind='narrative';
  for(const [k,weight] of Object.entries(EVENT_TABLE[diff]||EVENT_TABLE.normal)){
    acc += weight; if(eRoll.value<=acc){ kind = k; break; }
  }
  const sRoll = popRoll(run, 5); run.prerolls = sRoll.next;
  const baseDelta = { safe:[0,2], item:[0,1], narrative:[0,1], risk:[-3,-1], combat:[-5,-2] }[kind] || [0,0];
  const mul = { easy:.8, normal:1.0, hard:1.15, vhard:1.3, legend:1.5 }[diff] || 1.0;
  const lo = Math.round(baseDelta[0]*mul), hi = Math.round(baseDelta[1]*mul);
  const deltaStamina = (lo===hi) ? lo : (lo<0 ? -((sRoll.value%(-lo+ -hi+1)) + -hi) : (sRoll.value%(hi-lo+1))+lo);

  const out = { eventKind: kind, deltaStamina };

  if(kind==='item'){
    const r = popRoll(run, 1000); run.prerolls = r.next;
    const rarity = (RARITY_TABLE.find(x=> r.value<=x.upto) || RARITY_TABLE.at(-1)).rarity;
    const usesLimited = (popRoll(run,2).value===2);
    const usesRemaining = usesLimited ? (popRoll(run,3).value) : 0;
    out.item = { rarity, usesLimited, usesRemaining };
  }else if(kind==='combat'){
    const r = popRoll(run, 1000); run.prerolls = r.next;
    const tier = (COMBAT_TIER[diff]||COMBAT_TIER.normal).find(x=>r.value<=x.p)?.t || 'normal';
    out.combat = { enemyTier: tier };
  }
  return out;
}

export async function appendEvent({ runId, runBefore, narrative, choices, delta, dice, summary3 }){
  const ref = fx.doc(db,'explore_runs', runId);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('런이 없어');
  const cur = snap.data();

  const stamina = Math.max(0, Math.min(cur.stamina_start, (cur.stamina||0) + (delta||0)));
  const next = {
    stamina,
    turn: (cur.turn||0) + 1,
    prerolls: runBefore.prerolls,
    events: [...(cur.events||[]), {
      t: Date.now(),
      kind: dice.eventKind,
      note: narrative,
      choice_labels: choices,
      deltaStamina: delta,
      rolls_used: [], tags: []
    }],
    summary3: summary3 ?? (cur.summary3||''),
    updatedAt: Date.now()
  };
  await fx.updateDoc(ref, next);
  return { ...cur, ...next, id: runId };
}
