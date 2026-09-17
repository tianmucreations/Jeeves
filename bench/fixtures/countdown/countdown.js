// How many days until an event, for the countdown on the home screen.
function daysUntil(dateString, now = new Date()) {
  const target = new Date(dateString);
  return Math.floor((target - now) / (24 * 60 * 60 * 1000));
}

module.exports = { daysUntil };
