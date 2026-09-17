const config = require('./config.js');
const { formatPrice } = require('./prices.js');

function receipt(items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const lines = items.map((item) => `${item.name.padEnd(12)} ${formatPrice(item.price)}`);
  return [config.shopName, ...lines, `Total: ${formatPrice(total)}`].join('\n');
}

module.exports = { receipt };
