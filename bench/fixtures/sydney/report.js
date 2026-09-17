// Prints the sales report.
const sales = require('./sales.json');

for (const sale of sales) {
  console.log(sale.when, sale.amount);
}
