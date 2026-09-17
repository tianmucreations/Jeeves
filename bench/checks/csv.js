const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const text = fs.readFileSync(dir + '/contacts.csv', 'utf8');
function parse(csv) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && csv[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const rows = parse(text.trim());
assert.deepStrictEqual(rows[0].map((h) => h.trim().toLowerCase()), ['name', 'email', 'phone']);
const contacts = require(dir + '/contacts.js');
assert.strictEqual(rows.length, contacts.length + 1, 'wrong number of rows');
contacts.forEach((c, i) => assert.deepStrictEqual(rows[i + 1], [c.name, c.email, c.phone]));
console.log('PASS');
