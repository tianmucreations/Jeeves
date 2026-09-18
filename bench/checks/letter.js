const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const text = fs.readFileSync(dir + '/letter.txt', 'utf8');
// Every fact given is kept exactly; nothing is left for the person to fill in.
for (const fact of ['Patel', '4B', '12 Elm Road', 'boiler', 'Alex Morgan']) assert(text.includes(fact), 'missing ' + fact);
assert(/3(rd)? September 2026|September 3(rd)?,? 2026/.test(text), 'missing the date');
assert(!/\[[^\]]*\]|<[^>]+>|\bXX+\b|your name|your address|insert/i.test(text), 'has a placeholder');
console.log('PASS');
