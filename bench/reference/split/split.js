function splitBill(total, shares) {
  const cents = Math.round(total * 100);
  const totalShares = shares.reduce((sum, s) => sum + s, 0);
  const exact = shares.map((s) => (cents * s) / totalShares);
  const parts = exact.map(Math.floor);
  let left = cents - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; if (shares[i] > 0) { parts[i]++; left--; } }
  return parts.map((c) => c / 100);
}
module.exports = { splitBill };
