class Portfolio {
  constructor() { this.lots = []; }
  buy(quantity, price) { this.lots.push({ quantity, cost: quantity * price }); }
  split(ratio) { for (const lot of this.lots) lot.quantity *= ratio; }
  sell(quantity, price) {
    if (quantity > this.held() + 1e-9) throw new Error('not enough shares');
    let left = quantity; let cost = 0;
    while (left > 1e-9) {
      const lot = this.lots[0];
      const used = Math.min(left, lot.quantity);
      const part = lot.cost * (used / lot.quantity);
      cost += part; lot.cost -= part; lot.quantity -= used; left -= used;
      if (lot.quantity <= 1e-9) this.lots.shift();
    }
    return Math.round((price * quantity - cost) * 100) / 100;
  }
  held() { return this.lots.reduce((s, l) => s + l.quantity, 0); }
}
module.exports = { Portfolio };
