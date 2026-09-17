// The calculator behind the "quick sums" box. It only handles + and - for now.
function calculate(text) {
  let total = 0;
  for (const part of text.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) || []) total += Number(part);
  return total;
}

module.exports = { calculate };
