const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const ref = path.join(__dirname, '../reference/phone');
const files = ['index.html', 'about.html', 'contact.html', 'js/footer.js', 'notes.txt'];
const digits = (s) => s.replace(/[^\d]/g, '');
// Phone numbers taken out, the rest of each file must be exactly as before.
const phoneless = (s) => s.replace(/(tel:)?\+?[\d][\d ]{8,}\d/g, '#');
let newCount = 0;
for (const file of files) {
  const got = fs.readFileSync(path.join(dir, file), 'utf8');
  const want = fs.readFileSync(path.join(ref, file), 'utf8');
  assert.strictEqual(phoneless(got).trimEnd(), phoneless(want).trimEnd(), 'other text changed in ' + file);
  const numbers = (got.match(/\+?[\d][\d ]{8,}\d/g) ?? []).map(digits);
  assert(!numbers.some((n) => n.endsWith('1632960123')), 'old number still in ' + file);
  newCount += numbers.filter((n) => n.endsWith('1632960999')).length;
}
assert.strictEqual(newCount, 5, 'the new number should appear 5 times, found ' + newCount);
assert(fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('Fax: 01632 960 555'), 'the fax number was changed');
console.log('PASS');
