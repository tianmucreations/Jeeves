const assert = require('assert');
const dir = process.argv[2];
const { calculate } = require(dir + '/calc.js');
const ok = [
  ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['2 ^ 3 ^ 2', 512], ['-2 ^ 2', -4], ['(-2) ^ 2', 4], ['10 / 4', 2.5],
  ['2 * -3', -6], ['--3', 3], ['1 - -1', 2], ['3 + 4 * 2 / (1 - 5) ^ 2 ^ 3', 3.0001220703125], ['  7  ', 7], ['0.1 + 0.2', 0.3],
  ['2(3)', null], ['1 +', null], ['(1 + 2', null], ['1 + 2)', null], ['', null], ['4 / 0', null], ['abc', null], ['1 2', null], ['2 ^^ 3', null],
];
for (const [input, expected] of ok) {
  if (expected === null) {
    assert.throws(() => calculate(input), undefined, `should refuse: "${input}"`);
  } else {
    const got = calculate(input);
    assert.ok(Math.abs(got - expected) < 1e-9, `"${input}" gave ${got}, expected ${expected}`);
  }
}
console.log('PASS');
