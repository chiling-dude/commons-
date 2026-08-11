// Report-triggered escalation. A "violation" row is only ever inserted when a
// moderator takes action on a filed report — never from automated scanning.
//
//   streak 1  -> Warning
//   streak 2  -> 1 week suspension
//   streak 3  -> 1 month suspension
//   streak 4+ -> Permanent restriction, account deleted 24h later

const PERMANENT_BAN_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;

function computeStreak(timestamps) {
  if (!timestamps || timestamps.length === 0) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (sorted[i] - sorted[i - 1]) / 86400000;
    streak = gapDays <= 14 ? streak + 1 : 1;
  }
  return streak;
}

function escalationStatus(timestamps) {
  const streak = computeStreak(timestamps);
  if (streak <= 0) {
    return { stage: 0, label: 'No violations', suspended: false, permanent: false, until: null, permanentAt: null };
  }
  const last = Math.max(...timestamps);
  if (streak === 1) {
    return { stage: 1, label: 'Warning', suspended: false, permanent: false, until: null, permanentAt: null };
  }
  if (streak === 2) {
    return { stage: 2, label: '1 week suspension', suspended: true, permanent: false, until: last + 7 * 86400000, permanentAt: null };
  }
  if (streak === 3) {
    return { stage: 3, label: '1 month suspension', suspended: true, permanent: false, until: last + 30 * 86400000, permanentAt: null };
  }
  return { stage: 4, label: 'Permanent restriction', suspended: true, permanent: true, until: null, permanentAt: last };
}

module.exports = { computeStreak, escalationStatus, PERMANENT_BAN_DELETE_DELAY_MS };
