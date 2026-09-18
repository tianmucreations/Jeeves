const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const rows = fs.readFileSync(dir + '/clean.csv', 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
// Same email (ignoring capitals and spaces) is the same person; the first one is kept as written.
assert.deepStrictEqual(rows, [
  ['name', 'email', 'phone'],
  ['Ann Lee', 'ann@example.com', '0400 111 222'],
  ['Bob Stone', 'bob@example.com', '0400 333 444'],
  ['Cara Diaz', 'cara@example.com', '0400 555 666'],
  ['Dan Wu', 'dan@example.org', ''],
  ['Eve Ng', 'eve@example.com', '0400 777 888'],
]);
console.log('PASS');
