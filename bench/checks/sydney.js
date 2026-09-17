const { execSync } = require('child_process');
const assert = require('assert');
const dir = process.argv[2];
const sales = require(dir + '/sales.json');
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' });
const totals = new Map();
for (const s of sales) {
  const parts = fmt.formatToParts(new Date(s.when));
  const key = parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value;
  totals.set(key, (totals.get(key) ?? 0) + Math.round(s.amount * 100));
}
const expected = [...totals.keys()].sort().map((k) => `${k}: $${(totals.get(k) / 100).toFixed(2)}`);
for (const tz of ['Asia/Bangkok', 'America/New_York', 'UTC']) {
  const out = execSync('node report.js', { cwd: dir, env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim().split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepStrictEqual(out, expected, `in ${tz}:\n${out.join('\n')}\nexpected:\n${expected.join('\n')}`);
}
console.log('PASS');
