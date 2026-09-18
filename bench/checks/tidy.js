const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const expected = {
  'Pictures/holiday.jpg': 'jpg holiday', 'Pictures/cat.PNG': 'png cat',
  'Documents/scan.pdf': 'pdf scan', 'Documents/cv.docx': 'docx cv', 'Documents/notes.txt': 'txt notes',
  'Spreadsheets/budget.csv': 'a,b\n1,2\n', 'Spreadsheets/sales.xlsx': 'xlsx sales',
  'song.mp3': 'mp3 song', 'keep/important.txt': 'keep me', 'keep/photo.jpg': 'keep photo',
};
for (const [file, content] of Object.entries(expected)) assert.strictEqual(read(file), content, file);
// Nothing deleted, copied twice, or added: exactly these files remain.
const all = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = d ? `${d}/${e.name}` : e.name; e.isDirectory() ? walk(p) : all.push(p); } };
walk('');
assert.deepStrictEqual(all.sort(), Object.keys(expected).sort());
console.log('PASS');
