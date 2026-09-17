function daysUntil(dateString, now = new Date()) {
  const [y, m, d] = dateString.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}
module.exports = { daysUntil };
