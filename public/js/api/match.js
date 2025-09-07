// 매칭 API 어댑터(스텁) — 다음 단계에서 Cloud Functions와 연결
export async function requestMatch(charId, mode){
  // TODO: HTTPS Callable 연결 (functions: requestMatch)
  // 지금은 더미 반환
  return {
    ok: true,
    token: 'dev-token',
    opponent: { id: 'chars/demo', name: '상대(더미)', elo: 1200 }
  };
}

export async function cancelMatch(token){
  // TODO: HTTPS Callable 연결 (functions: cancelMatch)
  return { ok: true };
}
