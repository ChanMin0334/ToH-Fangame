// functions/mail.js
// 메일: 발송(sendMail) / 수령(claimMail)
// - 발송: 공지/경고/일반 지원. 일반은 첨부 { ticket: { weights } } 또는 기존 coins/items도 허용
// - 만료시각: expiresAt(ms) 직접 지정 가능(없으면 null)
// - 수령: ticket이 있으면 서버에서 가중치 추첨 → Firestore configs/prompts.gacha_item_system 로 시스템 프롬프트 로딩
//         → functions/index.js에 정의된 HTTP 함수 aiGenerate 호출로 아이템 생성(JSON) → 유저 인벤토리에 추가
//         (아이템 스키마: {id, name, rarity, isConsumable, uses, description})

module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();
  const fetch = (...args)=>import('node-fetch').then(({default:fetch})=>fetch(...args)); // ESM 호환

  async function isAdmin(uid){
    if(!uid) return false;
    try{
      const snap = await db.doc('configs/admins').get();
      const d = snap.exists ? snap.data() : {};
      const allow = Array.isArray(d.allow) ? d.allow : [];
      const allowEmails = Array.isArray(d.allowEmails) ? d.allowEmails : [];
      if (allow.includes(uid)) return true;
      const u = await admin.auth().getUser(uid);
      return !!(u?.email && allowEmails.includes(u.email));
    }catch(e){
      logger.error('[mail] isAdmin fail', e);
      return false;
    }
  }

  function tsFrom(ms){
    try{
      const n = Number(ms);
      if (Number.isFinite(n) && n>0) return admin.firestore.Timestamp.fromMillis(n);
    }catch{}
    return null;
  }

  // === 발송 ===
  const sendMail = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    if (!await isAdmin(uid)) throw new HttpsError('permission-denied','관리자만 가능');

    const {
      target, title, body, kind,
      expiresAt,          // ms (선택)
      attachments,        // { ticket?:{weights}, coins?, items? }
      // 구버전 호환
      expiresDays, prizeCoins, prizeItems
    } = req.data || {};

    if (!target || !title || !body) throw new HttpsError('invalid-argument','target/title/body 필수');

    // 만료 계산
    let expires = null;
    if (expiresAt) {
      expires = tsFrom(expiresAt);
    } else if (String(kind||'')==='general' && (expiresDays||0)>0) {
      const now = admin.firestore.Timestamp.now();
      expires = admin.firestore.Timestamp.fromMillis(now.toMillis() + Number(expiresDays)*24*60*60*1000);
    }

    // 첨부 정규화
    let attach = { coins:0, items:[], ticket:null };
    if (attachments?.ticket) {
      const w = attachments.ticket.weights || {};
      attach.ticket = {
        weights: {
          normal: Math.max(0, Number(w.normal||0)|0),
          rare:   Math.max(0, Number(w.rare||0)|0),
          epic:   Math.max(0, Number(w.epic||0)|0),
          legend: Math.max(0, Number(w.legend||0)|0),
          myth:   Math.max(0, Number(w.myth||0)|0),
          aether: Math.max(0, Number(w.aether||0)|0),
        }
      };
    }
    if (Number(prizeCoins)>0) attach.coins = Math.floor(Number(prizeCoins));
    if (Array.isArray(prizeItems)) {
      attach.items = prizeItems.map(it=>({
        name: String(it?.name||''),
        rarity: String(it?.rarity||'normal'),
        consumable: !!it?.consumable,
        count: Math.max(1, Math.floor(Number(it?.count||1)))
      })).filter(x=>x.name);
    }
    if (attachments?.coins) attach.coins = Math.max(attach.coins, Math.floor(Number(attachments.coins)||0));
    if (attachments?.items) {
      const arr = Array.isArray(attachments.items) ? attachments.items : [];
      attach.items = arr.map(it=>({
        name: String(it?.name||''),
        rarity: String(it?.rarity||'normal'),
        consumable: !!it?.consumable,
        count: Math.max(1, Math.floor(Number(it?.count||1)))
      })).filter(x=>x.name);
    }

    const doc = {
      kind: (['notice','warning','general'].includes(kind)) ? kind : 'notice',
      title: String(title).slice(0,100),
      body:  String(body).slice(0,1500),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
      from: 'admin',
      expiresAt: expires,
      attachments: attach,
      claimed: false
    };

    try{
      if (target === 'all'){
        const usersSnap = await db.collection('users').limit(500).get();
        if (usersSnap.empty) return { ok:true, sentCount:0 };
        const batch = db.batch();
        usersSnap.forEach(u=>{
          const ref = db.collection('mail').doc(u.id).collection('msgs').doc();
          batch.set(ref, doc);
        });
        await batch.commit();
        return { ok:true, sentCount: usersSnap.size };
      } else {
        const ref = db.collection('mail').doc(String(target)).collection('msgs').doc();
        await ref.set(doc);
        return { ok:true, sentCount: 1 };
      }
    }catch(e){
      logger.error('[mail] send error', e);
      throw new HttpsError('internal','메일 발송 실패');
    }
  });

  // === 수령 ===
  // 입력: { mailId, prompt? } — prompt는 뽑기권일 때만 사용(사용자 입력 텍스트)
  const claimMail = onCall({ region:'us-central1' }, async (req)=>{
    const uid = req.auth?.uid;
    if(!uid) throw new HttpsError('unauthenticated','로그인이 필요합니다.');
    const { mailId, prompt } = req.data || {};
    if(!mailId) throw new HttpsError('invalid-argument','mailId 필요');

    const mailRef = db.collection('mail').doc(uid).collection('msgs').doc(String(mailId));
    const snap = await mailRef.get();
    if (!snap.exists) throw new HttpsError('not-found','메일이 없습니다.');
    const m = snap.data() || {};

    if (m.claimed) throw new HttpsError('already-exists','이미 수령 완료');
    if (m.expiresAt?.toMillis && m.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('deadline-exceeded','유효기간이 지났습니다.');
    }

    // 일반 메일(보상) 로직
    if (m.kind !== 'general'){
      // 일반이 아니면 읽음 처리만 허용
      await mailRef.update({ read:true, claimed:true, claimedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { ok:true, readOnly:true };
    }

    const userRef = db.doc(`users/${uid}`);

    // 코인/고정 아이템 처리
    const coins = Math.max(0, Math.floor(Number(m?.attachments?.coins||0)));
    const staticItems = Array.isArray(m?.attachments?.items) ? m.attachments.items : [];

    // 뽑기권이 있으면 등급 추첨 + AI 아이템 생성
    let ticketItem = null;
    if (m?.attachments?.ticket){
      const weights = m.attachments.ticket.weights || {};
      const entries = Object.entries(weights).filter(([k,v])=>Number(v)>0);
      const total = entries.reduce((s,[,v])=>s+Number(v),0);
      if (entries.length && total>0){
        let r = Math.floor(Math.random()*total)+1;
        let picked = entries[0][0];
        for (const [rar, w] of entries){ r -= Number(w); if (r<=0){ picked = rar; break; } }

        // ===== [디버깅 시작] 생성 과정 전체를 로그로 기록합니다. =====
        const gachaLogRef = db.collection('gacha_logs').doc();
        let systemText = '', userText = '', rawAiResponse = '', errorLog = '';

        try{
          const ps = await db.collection('configs').doc('prompts').get();
          systemText = String((ps.exists && ps.data()?.gacha_item_system) || '');

          const baseUrl = 'https://us-central1-' + process.env.GCLOUD_PROJECT + '.cloudfunctions.net/aiGenerate';
          userText = `생성할 아이템의 희귀도: ${picked}\n유저의 요청사항: ${String(prompt||'없음').slice(0,500)}`;

          const res = await fetch(baseUrl, {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({
              model: 'gemini-1.5-flash',
              systemText,
              userText,
              temperature: 0.9,
              maxOutputTokens: 1024
            })
          });

          const j = await res.json().catch(()=>({}));
          rawAiResponse = j?.text || ''; // AI가 보낸 원본 텍스트 저장
          const gen = rawAiResponse ? JSON.parse(rawAiResponse) : {};
          
          const name = String(gen?.name || '이름 없는 아이템');
          const description = String(gen?.description || '').slice(0, 500);
          const isConsumable = !!gen?.isConsumable;
          const uses = Math.max(1, Number(gen?.uses||1));

          ticketItem = {
            id: `item_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            name,
            description,
            rarity: picked,
            isConsumable,
            uses
          };
        }catch(e){
          logger.error('[mail] aiGenerate failed', e);
          errorLog = e.message || String(e); // 에러 메시지 저장
          ticketItem = {
            id: `item_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            name: `${picked.toUpperCase()} 등급 보상`,
            description: 'AI 생성 실패로 기본 보상이 지급되었습니다.',
            rarity: picked,
            isConsumable: false,
            uses: 1
          };
        }

        // Firestore 'gacha_logs' 컬렉션에 모든 정보 저장
        await gachaLogRef.set({
          uid,
          mailId,
          at: admin.firestore.FieldValue.serverTimestamp(),
          request: {
            rarity: picked,
            userPrompt: prompt || null,
          },
          ai_input: {
            systemPrompt: systemText,
            userPrompt: userText,
          },
          ai_output: {
            rawResponse: rawAiResponse,
          },
          result: {
            generatedItem: ticketItem,
            error: errorLog || null,
          }
        });
        // ===== [디버깅 끝] =====
      }
    }

    await db.runTransaction(async (tx)=>{
      const uSnap = await tx.get(userRef);
      if (!uSnap.exists) throw new HttpsError('not-found','유저 문서 없음');

      const cur = Array.isArray(uSnap.get('items_all')) ? uSnap.get('items_all') : [];
      const add = [];

      // 코인
      if (coins>0){
        tx.update(userRef, { coins: admin.firestore.FieldValue.increment(coins) });
      }
      // 고정 아이템
      for (const it of staticItems){
        add.push({
          id: `mail_${snap.id}_${Math.random().toString(36).slice(2,8)}`,
          name: String(it.name||'Gift'),
          rarity: String(it.rarity||'normal'),
          isConsumable: !!(it.consumable||it.isConsumable),
          uses: Math.max(1, Math.floor(Number(it.count||1))), // count→uses
          description: String(it.description||'')
        });
      }
      // 뽑기권 결과 아이템
      if (ticketItem) add.push(ticketItem);

      if (add.length){
        tx.update(userRef, { items_all: [...cur, ...add] });
      }

      tx.update(mailRef, {
        read: true,
        claimed: true,
        claimedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return { ok:true, ticket: ticketItem ? { rarity: ticketItem.rarity, id: ticketItem.id } : null };
  });

  return { sendMail, claimMail };
};
