const sales = require('./sales.json');
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' });
const totals = new Map();
for (const s of sales) {
  const p = fmt.formatToParts(new Date(s.when));
  const k = p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value;
  totals.set(k, (totals.get(k) ?? 0) + Math.round(s.amount * 100));
}
for (const k of [...totals.keys()].sort()) console.log(`${k}: $${(totals.get(k) / 100).toFixed(2)}`);
