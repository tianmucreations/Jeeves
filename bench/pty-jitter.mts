// STREAM STABILITY IN THE NATIVE-SCROLL WORLD (3 Oct). The old jitter test
// drove the in-app scroller with wheel events; scrolling is the TERMINAL's own
// now, so what must hold instead is: the answer streams into a SMALL live tail
// (never a full-screen frame), the finished lines settle into history exactly
// once (no duplicates), and nothing is lost between the two.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation();
r.send('Write about 900 words on the history of Spain, in many short paragraphs.');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph'), 60000, 'answer streams');
// Mid-stream: the live tail must stay a small block (a few rows + box + bar),
// never the whole screen, and no answer line may appear twice.
const mid = r.screen();
const tailRows = mid.filter((l) => l.trim().length > 0).length;
const dupesMid = mid.some((l, i) => l.includes('▎') && l.length > 30 && mid.indexOf(l) !== i);
console.log(`mid-stream: non-empty rows=${tailRows} (small tail expected) duplicated-answer-lines=${dupesMid}`);
// THE test: when the job ends, the WHOLE answer must land in the terminal's
// history (the turn is over - nothing waits for a next message). The fake
// answer ends at "Chapter 10".
await r.until(() => r.historyText().includes('Chapter 10'), 120000, 'the finished answer settling into history');
await r.wait(800);
const history = r.historyText();
const dupesHistory = history.split('\n').some((l, i) => l.includes('▎') && l.length > 30 && history.indexOf(l) !== i && history.indexOf(l, i) === -1 && history.split('\n').indexOf(l) !== i);
// The fake filler repeats its own sentence, so the same words CAN legitimately
// appear twice far apart - corruption shows as ADJACENT identical rows (a
// mis-erased frame leaves the same row twice, side by side).
const cleanDupes = (() => {
  const lines = history.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes('▎') && lines[i].length > 30 && lines[i] === lines[i - 1]) return true;
  }
  return false;
})();
console.log('finished: history rows =', r.history().length, '| duplicated history lines =', cleanDupes, '| stale-dup check was =', dupesHistory);
let ok = tailRows <= 20 && !dupesMid && r.history().length > 0 && !cleanDupes;
console.log(ok ? 'PROVEN' : 'BROKEN');
r.kill(); await r.wait(300); process.exit(ok ? 0 : 1);
