function lineTotal(qty, price) { return qty * price; }
function invoiceTotal(lines, taxRate) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line.qty, line.price), 0);
  return Math.round((subtotal + subtotal * taxRate) * 100) / 100;
}
module.exports = { lineTotal, invoiceTotal };
