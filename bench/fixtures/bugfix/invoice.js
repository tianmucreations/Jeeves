// Works out invoice totals for the shop.
function lineTotal(qty, price) {
  return qty * price;
}

function invoiceTotal(lines, taxRate) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line.qty, line.price), 0);
  return subtotal + subtotal * taxRate;
}

module.exports = { lineTotal, invoiceTotal };
