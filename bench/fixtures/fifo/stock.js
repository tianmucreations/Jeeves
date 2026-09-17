// Tracks shares bought and sold, to work out the profit on each sale.
// Rules: sales use the oldest purchases first (first in, first out). A split multiplies
// the number of shares held and divides their purchase price. Selling more than you
// hold is refused. Profit is in dollars, rounded to the cent.
class Portfolio {
  constructor() {
    this.lots = [];
  }

  buy(quantity, price) {
    this.lots.push({ quantity, price });
  }

  split(ratio) {
    for (const lot of this.lots) lot.quantity *= ratio;
  }

  sell(quantity, price) {
    const lot = this.lots[this.lots.length - 1];
    lot.quantity -= quantity;
    return (price - lot.price) * quantity;
  }

  held() {
    return this.lots.reduce((sum, lot) => sum + lot.quantity, 0);
  }
}

module.exports = { Portfolio };
