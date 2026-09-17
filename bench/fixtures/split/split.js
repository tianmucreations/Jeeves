// Splits a bill between people by their shares (for example, 2 shares pay twice as much).
function splitBill(total, shares) {
  const totalShares = shares.reduce((sum, s) => sum + s, 0);
  return shares.map((s) => Math.round((total * s) / totalShares * 100) / 100);
}

module.exports = { splitBill };
