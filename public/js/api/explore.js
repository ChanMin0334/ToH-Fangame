// /public/js/api/explore.js (탐험 전용 모듈)
import { db, auth, fx, func } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { logInfo } from './logs.js';


import { EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS, apply as applyCooldown } from './cooldown.js';

const STAMINA_BASE = 10;
const call = (name)=> httpsCallable(func, name);

// (이벤트/아이템 테이블 등은 가독성을 위해 생략)
const EVENT_TABLE = {
  easy:   { safe:150, item:270, narrative:200, risk:230, combat:150 },
  normal: { safe:120, item:275, narrative:180, risk:235, combat:190 },
  hard:   { safe:90,  item:280, narrative:160, risk:240, combat:230 },
  vhard:  { safe:60,  item:285, narrative:140, risk:245, combat:270 },
  legend: { safe:30,  item:290, narrative:120, risk:250, combat:310 },
};
// ANCHOR: /public/js/api/explore.js
// ... (파일 상단)
const RARITY_TABLES_BY_DIFFICULTY = {
  // Normal: 50% / Rare: 30% / Epic: 13% / Legend: 5% / Myth: 2%
  normal: [
    { upto: 500, rarity: 'normal' },
    { upto: 800, rarity: 'rare'   },
    { upto: 930, rarity: 'epic'   },
    { upto: 980, rarity: 'legend' },
    { upto: 1000, rarity: 'myth'  },
  ],
  // Easy: 60% / Rare: 25% / Epic: 10% / Legend: 4% / Myth: 1%
  easy: [
    { upto: 600, rarity: 'normal' },
    { upto: 850, rarity: 'rare'   },
    { upto: 950, rarity: 'epic'   },
    { upto: 990, rarity: 'legend' },
    { upto: 1000, rarity: 'myth'  },
  ],
  // Hard: 40% / Rare: 35% / Epic: 17% / Legend: 6% / Myth: 2%
  hard: [
    { upto: 400, rarity: 'normal' },
    { upto: 750, rarity: 'rare'   },
    { upto: 920, rarity: 'epic'   },
    { upto: 980, rarity: 'legend' },
    { upto: 1000, rarity: 'myth'  },
  ],
  // Vhard: 30% / Rare: 40% / Epic: 20% / Legend: 8% / Myth: 2%
  vhard: [
    { upto: 300, rarity: 'normal' },
    { upto: 700, rarity: 'rare'   },
    { upto: 900, rarity: 'epic'   },
    { upto: 980, rarity: 'legend' },
    { upto: 1000, rarity: 'myth'  },
  ],
  // Legend: 19.5% / Rare: 40% / Epic: 25% / Legend: 10% / Myth: 5% / Aether: 0.5%
  legend: [
    { upto: 195, rarity: 'normal' },
    { upto: 595, rarity: 'rare'   },
    { upto: 845, rarity: 'epic'   },
    { upto: 945, rarity: 'legend' },
    { upto: 995, rarity: 'myth'  },
    { upto: 1000, rarity: 'aether'  },
  ],
};
// ...
const COMBAT_TIER = {
  easy:   [{p:600,t:'trash'},{p:950,t:'normal'},{p:1000,t:'elite'}],
  normal: [{p:350,t:'trash'},{p:900,t:'normal'},{p:980,t:'elite'},{p:1000,t:'boss'}],
  hard:   [{p:220,t:'trash'},{p:700,t:'normal'},{p:950,t:'elite'},{p:1000,t:'boss'}],
  vhard:  [{p:150,t:'trash'},{p:550,t:'normal'},{p:900,t:'elite'},{p:1000,t:'boss'}],
  legend: [{p:80, t:'trash'},{p:380,t:'normal'},{p:800,t:'elite'},{p:1000,t:'boss'}],
};


// ===== 💥 여기가 이 문제의 최종 해결책입니다 💥 =====
function makePrerolls(n=50, mod=1000){
  return Array.from({length:n}, ()=> Math.floor(Math.random()*mod)+1);
}

// ⚠️ 문제의 원인: 이 함수가 누락되었습니다.
// createRun 함수보다 앞에 위치시켜서, createRun이 이 함수를 찾을 수 있도록 합니다.
  
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

// 그 다음 hasActiveRunForChar 함수를 정의합니다. (기존 로직 분리)
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

// 서버 권위: 런 생성은 Cloud Functions 'startExplore'만 사용
export async function createRun({ world, site, char }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  const { data } = await httpsCallable(func, 'startExplore')({
    charId: char.id,
    worldId: world.id,
    siteId: site.id,
    difficulty: site.difficulty || 'normal'
  });

  if (!data?.ok) {
    // 쿨타임 등 사유 포함
    throw new Error(data?.reason || '탐험 시작 실패');
  }
  // 서버가 발급한 runId만 신뢰
  return data.runId;
}

// 새 함수: 한 턴 진행 (서버 난수/검증)
export async function stepRun({ runId }){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const { data } = await httpsCallable(func, 'stepExplore')({ runId });
  if (!data?.ok) throw new Error(data?.reason || '턴 진행 실패');
  return data; // { ok, done, step, staminaNow, event }
}


// (이하 endRun, rollStep 등 나머지 함수들은 변경사항 없음)
// 서버 권위: 종료/보상 확정도 Cloud Functions 'endExplore'만 사용
export async function endRun({ runId, reason = 'ended' }){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const { data } = await httpsCallable(func, 'endExplore')({ runId });
  if (!data?.ok) throw new Error(data?.reason || '탐험 종료 실패');
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

    // 현재 난이도에 맞는 희귀도 테이블을 선택 (없으면 normal 기본값)
    const currentRarityTable = RARITY_TABLES_BY_DIFFICULTY[diff] || RARITY_TABLES_BY_DIFFICULTY.normal;
    // 선택된 테이블에서 희귀도를 결정
    const rarity = (currentRarityTable.find(x=> r.value<=x.upto) || currentRarityTable.at(-1)).rarity;
    
    // 💥 아이템 상세 정보 추가
    const isConsumable = (popRoll(run, 10).value <= 7); // 70% 확률로 소모성
    const uses = isConsumable ? (popRoll(run, 3).value) : 1; // 소모성이면 1~3회

    out.item = { rarity, isConsumable, uses };
  }else if(kind==='combat'){
    const r = popRoll(run, 1000); run.prerolls = r.next;
    const tier = (COMBAT_TIER[diff]||COMBAT_TIER.normal).find(x=>r.value<=x.p)?.t || 'normal';
    out.combat = { enemyTier: tier };
  }
  return out;
}



// ANCHOR: /public/js/api/explore.js

// ... rollStep 함수 아래에 추가 ...

// 💥 신규 함수: 3개의 선택지 결과를 미리 생성
export function rollThreeChoices(run) {
  let remainingPrerolls = Array.isArray(run.prerolls) ? run.prerolls.slice() : [];
  const choices = [];
  
  // 독립적인 이벤트 3개를 생성
  for (let i = 0; i < 3; i++) {
    // 임시 run 객체를 만들어 preroll 상태를 전달
    const tempRun = { ...run, prerolls: remainingPrerolls };
    const result = rollStep(tempRun);
    
    // rollStep이 소비한 preroll을 반영
    remainingPrerolls = tempRun.prerolls;
    choices.push(result);
  }

  // 최종적으로 소비된 preroll 상태와 3개의 선택지 결과를 반환
  return {
    nextPrerolls: remainingPrerolls,
    choices: choices
  };
}

// /public/js/api/explore.js

// ... (파일 상단은 그대로 둠) ...

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
    // [추가] 선택지 상태를 null로 초기화하여 새로고침 문제 해결
    pending_choices: null,
  };

  await fx.updateDoc(ref, next);
  
  // [추가] 새 아이템이 있으면 공유 인벤토리에 추가
  if (newItem && newItem.id) {
    const userInvRef = fx.doc(db, 'users', u.uid);
    await fx.updateDoc(userInvRef, {
      items_all: fx.arrayUnion(newItem)
    }, { merge: true }); // 문서가 없으면 생성
  }

  return { ...cur, ...next, id: runId };
}
