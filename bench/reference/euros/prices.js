function formatPrice(amount) {
  return '€' + amount.toFixed(2);
}

function priceList(items) {
  return items.map((item) => `${item.name}: €${item.price.toFixed(2)}`).join('\n');
}

module.exports = { formatPrice, priceList };
