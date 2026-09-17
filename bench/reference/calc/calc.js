function calculate(text) {
  const tokens = text.match(/\d+(\.\d+)?|[-+*/^()]|\S/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => { if (tokens[i] !== t) throw new Error('bad'); i++; };
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = tokens[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const op = tokens[i++]; const r = unary(); if (op === '/' && r === 0) throw new Error('zero'); v = op === '*' ? v * r : v / r; } return v; }
  function unary() { if (peek() === '-') { i++; return -unary(); } return power(); }
  function power() { const b = primary(); if (peek() === '^') { i++; return b ** unary(); } return b; }
  function primary() { const t = tokens[i]; if (t === '(') { i++; const v = expr(); take(')'); return v; } if (t !== undefined && /^\d/.test(t)) { i++; return Number(t); } throw new Error('bad'); }
  const v = expr();
  if (i !== tokens.length) throw new Error('bad');
  return v;
}
module.exports = { calculate };
