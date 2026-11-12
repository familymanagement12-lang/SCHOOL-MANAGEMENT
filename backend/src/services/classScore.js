function calculateClassScore(earned, possible) {
  const earnedPoints = Number(earned);
  const possiblePoints = Number(possible);
  if (!Number.isFinite(earnedPoints) || !Number.isFinite(possiblePoints) || possiblePoints <= 0) return 0;
  return Math.round((earnedPoints / possiblePoints) * 5000) / 100;
}

module.exports = { calculateClassScore };
