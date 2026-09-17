const fs = require('fs');
const FILE = __dirname + '/todos.json';
function fail(msg) { console.error(msg); process.exit(1); }
let data = { items: [], nextId: 1 };
if (fs.existsSync(FILE)) { try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { fail('The to-do file is damaged, so nothing was changed.'); } }
const save = () => fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
const [cmd, ...rest] = process.argv.slice(2);
const find = (n) => data.items.find((t) => t.id === Number(n)) || fail(`There is no to-do number ${n}.`);
if (cmd === 'add') { const text = rest.join(' ').trim(); if (!text) fail('Say what to add, like: todo add Buy milk'); const t = { id: data.nextId++, text, done: false }; data.items.push(t); save(); console.log(`Added ${t.id}: ${t.text}`); }
else if (cmd === 'done') { const t = find(rest[0]); t.done = true; save(); console.log(`Done ${t.id}: ${t.text}`); }
else if (cmd === 'remove') { const t = find(rest[0]); data.items = data.items.filter((x) => x !== t); save(); console.log(`Removed ${t.id}: ${t.text}`); }
else if (cmd === 'list') { console.log(data.items.length ? data.items.map((t) => `${t.id}. [${t.done ? 'x' : ' '}] ${t.text}`).join('\n') : 'Nothing to do.'); }
else fail('Use: add, done, remove, list');
