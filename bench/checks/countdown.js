const { execSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const dir = process.argv[2];
const hash = crypto.createHash('sha256').update(fs.readFileSync(dir + '/countdown.test.js')).digest('hex');
assert.strictEqual(hash, process.argv[3], 'the test file was changed');
const probe = `const {daysUntil}=require(${JSON.stringify(dir + '/countdown.js')});const a=require('assert');
a.strictEqual(daysUntil('2026-09-20', new Date(2026,8,17,23,0)),3);
a.strictEqual(daysUntil('2026-09-20', new Date(2026,8,17,0,30)),3);
a.strictEqual(daysUntil('2026-09-20', new Date(2026,8,20,12,0)),0);
a.strictEqual(daysUntil('2026-10-05', new Date(2026,8,30,22,0)),5);
a.strictEqual(daysUntil('2027-01-01', new Date(2026,11,31,23,59)),1);`;
const probeFile = require('os').tmpdir() + '/countdown-probe-' + process.pid + '.js';
fs.writeFileSync(probeFile, probe);
for (const tz of ['Asia/Bangkok', 'America/Los_Angeles', 'Pacific/Auckland', 'Europe/London', 'UTC']) {
  try {
    execSync(`node ${probeFile}`, { env: { ...process.env, TZ: tz }, stdio: 'pipe' });
  } catch (error) {
    console.log(`FAIL in ${tz}: ${String(error.stderr).split('\n').find((l) => l.includes('Expected') || l.includes('AssertionError')) ?? ''}`);
    process.exit(1);
  }
  execSync('node --test', { cwd: dir, env: { ...process.env, TZ: tz }, stdio: 'pipe' });
}
console.log('PASS');
