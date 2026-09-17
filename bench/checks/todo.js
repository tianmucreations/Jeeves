const { execFileSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const run = (...args) => {
  try { return { out: execFileSync('node', ['todo.js', ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim(), code: 0 }; }
  catch (e) { return { out: String(e.stdout || '') + String(e.stderr || ''), code: e.status }; }
};
fs.rmSync(dir + '/todos.json', { force: true });
assert.strictEqual(run('list').out, 'Nothing to do.');
assert.strictEqual(run('add', 'Buy milk').out, 'Added 1: Buy milk');
assert.strictEqual(run('add', 'Call Mum, then Dad').out, 'Added 2: Call Mum, then Dad');
assert.strictEqual(run('add', 'Pay rent').out, 'Added 3: Pay rent');
assert.strictEqual(run('done', '2').out, 'Done 2: Call Mum, then Dad');
assert.strictEqual(run('list').out, '1. [ ] Buy milk\n2. [x] Call Mum, then Dad\n3. [ ] Pay rent');
assert.strictEqual(run('remove', '1').out, 'Removed 1: Buy milk');
assert.strictEqual(run('add', 'Water plants').out, 'Added 4: Water plants', 'numbers are never reused');
assert.strictEqual(run('list').out, '2. [x] Call Mum, then Dad\n3. [ ] Pay rent\n4. [ ] Water plants');
const bad = run('done', '9');
assert.strictEqual(bad.out.trim(), 'There is no to-do number 9.'); assert.notStrictEqual(bad.code, 0);
const bad2 = run('add');
assert.strictEqual(bad2.out.trim(), 'Say what to add, like: todo add Buy milk'); assert.notStrictEqual(bad2.code, 0);
const data = JSON.parse(fs.readFileSync(dir + '/todos.json', 'utf8'));
assert.ok(Array.isArray(data.items) && typeof data.nextId === 'number', 'todos.json shape');
fs.writeFileSync(dir + '/todos.json', '{ broken');
const broken = run('list');
assert.strictEqual(broken.out.trim(), 'The to-do file is damaged, so nothing was changed.'); assert.notStrictEqual(broken.code, 0);
assert.strictEqual(fs.readFileSync(dir + '/todos.json', 'utf8'), '{ broken', 'a damaged file must not be overwritten');
console.log('PASS');
