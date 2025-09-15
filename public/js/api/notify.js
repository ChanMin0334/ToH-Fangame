// 쿨타임이 많이 남았는데도 시작하려 하면(30분 이상 남음) 네 우편함으로 알림
try {
  const remain = Number(getCdRemain(EXPLORE_COOLDOWN_KEY) || 0);
  if (remain > EXPLORE_EARLY_NOTIFY_MS) {
    await notifyAdminEarlyAttempt('explore', remain, Number(EXPLORE_COOLDOWN_MS || (60*60*1000)), {
      world: world.name || world.id,
      site: site.name || site.id,
      charId: char.id
    });
  }
} catch (e) {
  console.warn('[explore] early-attempt notify skipped', e);
}
