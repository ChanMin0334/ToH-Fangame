// /public/js/api/explore.js (탐험 전용 모듈)
import { db, auth, fx } from './firebase.js';
import { grantExp } from './store.js';

// 🚨🚨🚨 에러의 원인이 된 이 import 구문을 완전히 삭제했습니다. 🚨🚨🚨

const STAMINA_BASE = 10;

// (이벤트/아이템 테이블 등은 가독성을 위해 생략)
const EVENT_TABLE = {
  easy:   { safe:150, item:270, narrative:200, risk:230, combat:150 },
  normal: { safe:120, item:275, narrative:180, risk:235, combat:190 },
  hard:   { safe:90,  item:280, narrative:160, risk:240, combat:230 },
  vhard:  { safe:60,  item:285, narrative:140, risk:245, combat:270 },
  legend: { safe:30,  item:290, narrative:120, risk:250, combat:310 },
};
const RARITY_TABLES_BY_DIFFICULTY = {
  normal: [ { upto: 500, rarity: 'normal' }, { upto: 800, rarity: 'rare' }, { upto: 930, rarity: 'epic' }, { upto: 980, rarity: 'legend' }, { upto: 1000, rarity: 'myth' } ],
  easy: [ { upto: 600, rarity: 'normal' }, { upto: 850, rarity: 'rare' }, { upto: 950, rarity: 'epic' }, { upto: 990, rarity: 'legend' }, { upto: 1000, rarity: 'myth' } ],
  hard: [ { upto: 400, rarity: 'normal' }, { upto: 750, rarity: 'rare' }, { upto: 920, rarity: 'epic' }, { upto: 980, rarity: 'legend' }, { upto: 1000, rarity: 'myth' } ],
  vhard: [ { upto: 300, rarity: 'normal' }, { upto: 700, rarity: 'rare' }, { upto: 900, rarity: 'epic' }, { upto: 980, rarity: 'legend' }, { upto: 1000, rarity: 'myth' } ],
  legend: [ { upto: 200, rarity: 'normal' }, { upto: 600, rarity: 'rare' }, { upto: 850, rarity: 'epic' }, { upto: 950, rarity: 'legend' }, { upto: 1000, rarity: 'myth' } ],
};
const COMBAT_TIER = {
  easy:   [{p:600,t:'trash'},{p:950,t:'normal'},{p:1000,t:'elite'}],
  normal: [{p:350,t:'trash'},{p:900,t:'normal'},{p:980,t:'elite'},{p:1000,t:'boss'}],
  hard:   [{p:220,t:'trash'},{p:700,t:'normal'},{p:950,t:'elite'},{p:1000,t:'boss'}],
  vhard:  [{p:150,t:'trash'},{p:550,t:'normal'},{p:900,t:'elite'},{p:1000,t:'boss'}],
  legend: [{p:80, t:'trash'},{p:380,t:'normal'},{p:800,t:'elite'},{p:1000,t:'boss'}],
};

function makePrerolls(n=50, mod=1000){
  return Array.from({length:n}, ()=> Math.floor(Math.random()*mod)+1);
}

export async function findMyActiveRun(){
  const u = auth.currentUser; if(!u) return null;
  const q = fx.query(
    fx.collection(db,'explore_runs'),
    fx.where('owner_uid','==', u.uid),
    fx.where('status','==','ongoing'),
    fx.orderBy('startedAt','desc'),
    fx.limit(1)
  );
  const s = await fx.getDocs(q);
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}

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

// 🚨 이제 이 함수는 adventure.js에서 직접 호출되지 않습니다.
// 대신 서버 함수(startExplore)가 호출됩니다. 하지만 다른 곳에서 사용할 수 있으므로 남겨둡니다.
export async function createRun({ world, site, char }){
  const u = auth.currentUser;
  if(!u) {
    throw new Error('인증 정보가 없습니다. 다시 로그인해주세요.');
  }

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

  let runRef;
  try {
    runRef = await fx.addDoc(fx.collection(db, 'explore_runs'), payload);
    const charRef = fx.doc(db, 'chars', char.id);
    await fx.updateDoc(charRef, { last_explore_startedAt: fx.serverTimestamp() });
  } catch (e) {
    console.error('[explore] A critical error occurred during sequential write:', e);
    throw new Error('탐험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  // 🚨🚨🚨 클라이언트에서 쿨타임을 적용하는 이 코드를 완전히 삭제했습니다. 🚨🚨🚨

  return runRef.id;
}


export async function endRun({ runId, reason = 'ended' }) {
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');
  const ref = fx.doc(db, 'explore_runs', runId);
  const snap = await fx.getDoc(ref);
  if (!snap.exists()) throw new Error('런이 없어');
  const run = snap.data();
  if (run.owner_uid !== u.uid) throw new Error('소유자가 아니야');
  if (run.status !== 'ongoing') return true;

  const diffMult = ({ easy:1.0, normal:1.2, hard:1.4, vhard:1.6, legend:1.8 }[run.difficulty]) || 1.2;
  const turns    = Math.max(0, Number(run.turn || 0));
  const runMult  = 1 + Math.min(0.6, Math.max(0, turns - 1) * 0.05);
  let exp        = Math.round(6 * turns * diffMult * runMult);
  exp            = Math.max(10, Math.min(120, exp));

  const charId = String(run.charRef || '').replace(/^chars\//, '');
  const { minted = 0 } = await grantExp(charId, exp, 'explore', `run:${runId}`);
  const prevRewards = Array.isArray(run.rewards) ? run.rewards : [];
  const rewards = prevRewards.concat([{ kind: 'exp', exp, minted }]);
  await fx.updateDoc(ref, {
    status: 'ended',
    endedAt: fx.serverTimestamp(),
    reason,
    rewards,
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

function popRoll(run, mod=1000){
  const arr = Array.isArray(run.prerolls) ? run.prerolls.slice() : [];
  const v = arr.length ? arr.shift() : (Math.floor(Math.random()*mod)+1);
  return { value: ((v-1)%mod)+1, next: arr };
}

export function rollStep(run){
  const diff = (run?.difficulty||'normal');
  const eRoll = popRoll(run, 1000); run.prerolls = eRoll.next;
  let acc=0, kind='narrative';
  for(const [k,weight] of Object.entries(EVENT_TABLE[diff]||EVENT_TABLE.normal)){
    acc += weight; if(eRoll.value<=acc){ kind = k; break; }
  }
  const sRoll = popRoll(run, 5); run.prerolls = sRoll.next;
  const baseDelta = { safe:[0,1], item:[-1,-1], narrative:[-1,-1], risk:[-3,-1], combat:[-5,-2] }[kind] || [0,0];
  const mul = { easy:.8, normal:1.0, hard:1.15, vhard:1.3, legend:1.5 }[diff] || 1.0;
  const lo = Math.round(baseDelta[0]*mul), hi = Math.round(baseDelta[1]*mul);
  const deltaStamina = (lo===hi) ? lo : (lo<0 ? -((sRoll.value%(-lo+ -hi+1)) + -hi) : (sRoll.value%(hi-lo+1))+lo);
  const out = { eventKind: kind, deltaStamina };

  if(kind==='item'){
    const r = popRoll(run, 1000); run.prerolls = r.next;
    const currentRarityTable = RARITY_TABLES_BY_DIFFICULTY[diff] || RARITY_TABLES_BY_DIFFICULTY.normal;
    const rarity = (currentRarityTable.find(x=> r.value<=x.upto) || currentRarityTable.at(-1)).rarity;
    const isConsumable = (popRoll(run, 10).value <= 7);
    const uses = isConsumable ? (popRoll(run, 3).value) : 1;
    out.item = { rarity, isConsumable, uses };
  }else if(kind==='combat'){
    const r = popRoll(run, 1000); run.prerolls = r.next;
    const tier = (COMBAT_TIER[diff]||COMBAT_TIER.normal).find(x=>r.value<=x.p)?.t || 'normal';
    out.combat = { enemyTier: tier };
  }
  return out;
}

export function rollThreeChoices(run) {
  let remainingPrerolls = Array.isArray(run.prerolls) ? run.prerolls.slice() : [];
  const choices = [];
  for (let i = 0; i < 3; i++) {
    const tempRun = { ...run, prerolls: remainingPrerolls };
    const result = rollStep(tempRun);
    remainingPrerolls = tempRun.prerolls;
    choices.push(result);
  }
  return {
    nextPrerolls: remainingPrerolls,
    choices: choices
  };
}

export async function appendEvent({ runId, runBefore, narrative, choices, delta, dice, summary3, newItem }){
  const u = auth.currentUser;
  if (!u) throw new Error('인증 정보 없음');

  const ref = fx.doc(db,'explore_runs', runId);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('런이 없어');
  const cur = snap.data();
  const stamina = Math.max(0, Math.min(cur.stamina_start, (cur.stamina||0) + (delta||0)));

  const newEvent = {
    t: Date.now(),
    note: narrative,
    choice_labels: choices,
    deltaStamina: delta,
    dice: dice,
  };

  const next = {
    stamina,
    turn: (cur.turn||0) + 1,
    prerolls: runBefore.prerolls,
    events: [...(cur.events||[]), newEvent],
    summary3: summary3 ?? (cur.summary3||''),
    updatedAt: fx.serverTimestamp(),
    pending_choices: null,
  };

  await fx.updateDoc(ref, next);
  
  if (newItem && newItem.id) {
    const userInvRef = fx.doc(db, 'users', u.uid);
    await fx.updateDoc(userInvRef, {
      items_all: fx.arrayUnion(newItem)
    }, { merge: true });
  }

  return { ...cur, ...next, id: runId };
}
