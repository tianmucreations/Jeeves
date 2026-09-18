import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const B = path.dirname(fileURLToPath(import.meta.url));
const P = path.dirname(B);
const { initKeys, getOpenRouterKey } = await import(P + '/src/providers/index.ts');
const { fetchKeyUsage } = await import(P + '/src/providers/openrouter.ts');
const { session } = await import(P + '/src/state/session.ts');
const { runTurn } = await import(P + '/src/agent/loop.ts');
const { answerApproval } = await import(P + '/src/agent/permissions.ts');
const { loadModels } = await import(P + '/src/models/registry.ts');
const { spentThisSession } = await import(P + '/src/agent/spending.ts');
const { clearConversation } = await import(P + '/src/commands/clear.ts');
await initKeys();
session.setModels((await loadModels()).models, '');
session.setProvider('openrouter');
session.setDailyLimit(100, 0);
const [h1, h2, h3, h4] = fs.readFileSync(B + '/hashes.txt', 'utf8').trim().split(' ');
const JOBS: Record<string, { prompt: string; fixture?: string; check: (dir: string, text: string, tools: string[]) => boolean }> = {
  chat: { prompt: "What's the difference between a file and a folder?", check: (_d, text, tools) => tools.length === 0 && text.length > 40 },
  research: { prompt: 'What is the latest Node.js LTS version?', check: (_d, text) => text.includes('24.21.0') },
  bugfix: { fixture: 'bugfix', prompt: 'The invoice total in this project is wrong - the test fails. Please fix it so the test passes, without changing the test.', check: (d) => runCheck('bugfix', d, h1) },
  csv: { fixture: 'csv', prompt: 'Please save my contacts from contacts.js into a spreadsheet file called contacts.csv, with the columns name, email and phone.', check: (d) => runCheck('csv', d) },
  euros: { fixture: 'euros', prompt: 'Change the shop to show prices in euros (€) instead of dollars, everywhere prices appear.', check: (d) => runCheck('euros', d) },
  split: { fixture: 'split', prompt: "When we split a bill, the amounts don't always add up to the total. The tests show it. Please fix it without changing the tests, so every split adds up to the exact cent and is fair to everyone's share.", check: (d) => runCheck('split', d, h3) },
  sydney: { fixture: 'sydney', prompt: "Make report.js print the total sales for each month, oldest month first, one line each like '2026-01: $123.45'. Count each sale in the month it happened in Sydney time.", check: (d) => runCheck('sydney', d) },
  bank: { fixture: 'bank', prompt: 'Work out how much I spent in each category from bank.csv and save it as summary.json, like {"Groceries": 123.45}. Refunds reduce what I spent, and income is not spending.', check: (d) => runCheck('bank', d) },
  calc: { fixture: 'calc', prompt: "Make the calculator in calc.js handle proper sums: + - * / ^ and brackets, with the usual order (^ first, and 2^3^2 means 2^(3^2)), a minus sign in front of a number (-2^2 is -4, 2*-3 is -6). If the sum isn't valid - like '1 +', '2(3)', unmatched brackets, dividing by zero, or letters - it must throw an error instead of giving a number.", check: (d) => runCheck('calc', d) },
  fifo: { fixture: 'fifo', prompt: "My share tracker in stock.js gives the wrong profits. The rules are written at the top of the file and the test shows one case. Please fix it so it follows all the rules, without changing the test.", check: (d) => runCheck('fifo', d, h4) },
  todo: { fixture: 'todo', prompt: "Write todo.js, a to-do list I run with node todo.js. Commands: 'add <text>' prints 'Added <n>: <text>'; 'done <n>' prints 'Done <n>: <text>'; 'remove <n>' prints 'Removed <n>: <text>'; 'list' prints each as '<n>. [ ] <text>' or '<n>. [x] <text>', or 'Nothing to do.' when empty. Numbers start at 1 and are never reused. Save everything in todos.json as {\"items\": [...], \"nextId\": <number>}. If the number doesn't exist print 'There is no to-do number <n>.'; 'add' with no text prints 'Say what to add, like: todo add Buy milk'; if todos.json is damaged print 'The to-do file is damaged, so nothing was changed.' and leave it untouched. All errors must exit with a non-zero code.", check: (d) => runCheck('todo', d) },
  // Everyday jobs (plan step 2, 18 Sept): letters, spreadsheets, folders, a website,
  // messy data, dates, careful edits, two-file sums, a change across many files, and
  // finding facts in a long document.
  letter: { prompt: 'Write a polite letter to my landlord, Mr Graham Patel, asking him to fix the boiler in flat 4B, 12 Elm Road, which has been broken since 3 September 2026. Sign it from Alex Morgan and save it as letter.txt.', check: (d) => runCheck('letter', d) },
  invoice: { fixture: 'invoice', prompt: 'From hours.csv, make invoice.csv for my client Brightside only: columns date, hours, amount (hours times that row\'s rate), one row per line of work, then a last row with TOTAL and the total amount. Amounts to the cent, no currency signs.', check: (d) => runCheck('invoice', d) },
  tidy: { fixture: 'tidy', prompt: "Tidy this folder: move pictures into a folder called Pictures, documents (PDF, Word and text files) into Documents, and spreadsheets (CSV and Excel) into Spreadsheets. Don't touch the keep folder, and don't delete anything.", check: (d) => runCheck('tidy', d) },
  website: { prompt: "Make a one-page website for my bakery, Rosie's Loaves, as index.html with its styling in a separate style.css. Address: 7 Mill Lane. Phone: 01632 960 123. Open Tuesday to Saturday, 8am to 4pm; closed Sunday and Monday. Menu: Sourdough £4.50, Rye £4.00, Cinnamon bun £2.75.", check: (d) => runCheck('website', d) },
  dedupe: { fixture: 'dedupe', prompt: 'contacts.csv has the same people more than once. Save a copy without the duplicates as clean.csv, with the same columns. The same email address means the same person, whatever the capitals or spaces; keep the first entry for each person exactly as written.', check: (d) => runCheck('dedupe', d) },
  dates: { fixture: 'dates', prompt: 'Turn events.txt into schedule.csv with the columns event, date, weekday: the date written as YYYY-MM-DD and the weekday as a full name like Monday, earliest first. The dates are written the British way, day first.', check: (d) => runCheck('dates', d) },
  minutes: { fixture: 'minutes', prompt: "In minutes.md, the meeting has moved: change every mention of Friday 19 September to Monday 22 September. Also correct the misspelling 'recieve'. Don't change anything else.", check: (d) => runCheck('minutes', d) },
  budget: { fixture: 'budget', prompt: 'Using income.csv and bills.csv, work out how much money is left in each month and save it as left.csv with the columns month and left. Monthly bills are paid every month, yearly ones only in the month shown, quarterly ones in the month shown and every third month after.', check: (d) => runCheck('budget', d) },
  phone: { fixture: 'phone', prompt: 'Our phone number has changed from 01632 960 123 to 01632 960 999. Update it everywhere on this website, however it is written. The fax number stays the same.', check: (d) => runCheck('phone', d) },
  report: { fixture: 'report', prompt: 'According to report.txt, how many members did the club have at the end of the year, and how much money was in the bank then? One sentence.', check: (_d, text) => text.includes('347') && /12,?480\.55/.test(text) },
  // Research before building (plan step 1b): a new program in an empty folder must be
  // researched - a page opened and a note recorded - before the first file is written.
  newbuild: { prompt: 'Make me a simple countdown timer web page, timer.html: I type a number of minutes, press Start, and it counts down to zero.', check: (d, _t, tools) => researchedFirst(tools) && builtTimer(d) },
  skipresearch: { prompt: 'Make me a simple countdown timer web page, timer.html: I type a number of minutes, press Start, and it counts down to zero. Skip the research.', check: (d, _t, tools) => !tools.some((x) => x.includes('webSearch') || x.includes('noteResearch')) && builtTimer(d) },
  countdown: { fixture: 'countdown', prompt: 'The countdown sometimes shows the wrong number of days. The tests show the problem - please fix it without changing the tests.', check: (d) => runCheck('countdown', d, h2) },
};
function builtTimer(dir: string): boolean {
  const file = `${dir}/timer.html`;
  return fs.existsSync(file) && /<input/i.test(fs.readFileSync(file, 'utf8'));
}
function researchedFirst(tools: string[]): boolean {
  const note = tools.findIndex((x) => x.startsWith('✓ noteResearch:Research noted'));
  const opened = tools.findIndex((x) => x.startsWith('✓ readWebPage'));
  const wrote = tools.findIndex((x) => x.startsWith('✓ writeFile'));
  return note >= 0 && opened >= 0 && opened < note && note < wrote;
}
function runCheck(job: string, dir: string, hash = ''): boolean {
  try { execSync(`node "${B}/checks/${job}.js" "${dir}" ${hash}`, { stdio: 'pipe', timeout: 60000 }); return true; } catch { return false; }
}
const unsafe = /(\.\.|~|\bsudo\b|\brm\b|\bcurl\b|\bwget\b|\bgit\b|\bnpm\s+(i|install)\b|\/Users\/(?!me\/)|^\s*\/)/;
session.subscribe(() => {
  if (!session.approvalPending) return;
  const last = [...session.transcript].reverse().find((e: any) => e.kind === 'tool' && e.data.state === 'awaiting') as any;
  if (!last) return answerApproval(true); // spending questions: yes (budget guarded here)
  const ok = last.data.tool === 'writeFile' || (last.data.tool === 'runBash' && !unsafe.test(last.data.summary));
  log(`    permission ${last.data.tool} "${last.data.summary}" -> ${ok ? 'yes' : 'no'}`);
  answerApproval(ok);
});
const out = B + '/results.jsonl';
function log(line: string) { fs.appendFileSync(B + '/bench.log', line + '\n'); console.log(line); }
const key = getOpenRouterKey()!;
const startUsage = (await fetchKeyUsage(key)) ?? 0;
const BUDGET = Number(process.env.BUDGET ?? 4.5);
const plan = (process.env.PLAN ?? '').split(',').filter(Boolean); // model:job:repeat
for (const entry of plan) {
  const [model, job, rep] = entry.split('|');
  const keyNow = ((await fetchKeyUsage(key)) ?? startUsage) - startUsage;
  const spent = Math.max(spentThisSession(), keyNow);
  if (spent > BUDGET) { log(`BUDGET STOP at $${spent.toFixed(3)}`); break; }
  const spec = JOBS[job];
  const dir = `${B}/runs/${model.replace(/\//g, '_')}${process.env.JEEVES_EXPERT_MODEL ? '+' + process.env.JEEVES_EXPERT_MODEL.replace(/\//g, '_') : ''}-${job}-${rep}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (spec.fixture) fs.cpSync(`${B}/fixtures/${spec.fixture}`, dir, { recursive: true });
  process.chdir(dir);
  clearConversation();
  session.transcript = [];
  session.setModel(model);
  const before = spentThisSession();
  const t = Date.now();
  let crashed = '';
  try {
    await Promise.race([runTurn(spec.prompt), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 8 min')), 480000))]);
  } catch (e) { crashed = String(e); }
  const tools = session.transcript.filter((e: any) => e.kind === 'tool').map((e: any) => `${e.data.state === 'done' ? '✓' : '✗'} ${e.data.tool}:${(e.data.label || e.data.summary).slice(0, 50)}`);
  const text = session.transcript.filter((e: any) => ['assistant', 'error', 'notice'].includes(e.kind)).map((e: any) => e.text).join(' | ');
  const pass = !crashed && spec.check(dir, text, tools);
  const row = { model, job, rep, pass, cost: +(spentThisSession() - before).toFixed(4), seconds: Math.round((Date.now() - t) / 1000), expert: tools.some((x) => x.includes('askExpert')), takeover: session.activeModel !== null && session.activeModel !== 'deepseek/deepseek-v4-flash-0731' && model === 'jeeves/auto', steps: tools.length, tools, crashed, text: text.slice(0, 300) };
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
  log(`${pass ? 'PASS' : 'FAIL'} ${model}${process.env.JEEVES_EXPERT_MODEL ? ' reviewer=' + process.env.JEEVES_EXPERT_MODEL : ''} ${job}#${rep} $${row.cost} ${row.seconds}s tools=${tools.length} expert=${row.expert}${crashed ? ' CRASH ' + crashed : ''}`);
  log(`    tools: ${tools.filter((x) => x.includes('askExpert')).join(' ; ')}`);
  if (!pass) log(`    said: ${text.replace(/\n/g, ' ').slice(0, 220)}\n    tools: ${tools.join(' ; ').slice(0, 400)}`);
}
await new Promise((r) => setTimeout(r, 20000));
log(`TOTAL reported $${spentThisSession().toFixed(4)}; key usage change $${(((await fetchKeyUsage(key)) ?? startUsage) - startUsage).toFixed(4)}`);
process.exit(0);
