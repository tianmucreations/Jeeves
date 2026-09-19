// Jeeves Desktop window: draws the engine's state and sends back what the person
// types or clicks. Text is only ever placed with textContent - never as HTML - so
// nothing a model or a web page writes can run in the window.
const $ = (id) => document.getElementById(id);
const els = {
  folder: $('folder'), light: $('light'), welcome: $('welcome'), chat: $('chat'), greeting: $('greeting'),
  projects: $('projects'), choose: $('choose'), nokeys: $('nokeys'), scroller: $('scroller'),
  transcript: $('transcript'), approval: $('approval'), approvalText: $('approval-text'), always: $('always'),
  composer: $('composer'), busy: $('busy'), stop: $('stop'), input: $('input'), hint: $('hint'), model: $('model'), segments: $('segments'),
};

let state = null;
const drawn = new Map(); // entry id -> { el, sig }

const LIGHT_TITLES = {
  idle: 'Ready', working: 'Working…', 'awaiting-approval': 'Waiting for your answer', disconnected: 'Not connected',
};

// A little of Markdown, drawn safely: headings, **bold** and `code`.
function fillRich(el, text) {
  el.textContent = '';
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const target = heading ? el.appendChild(Object.assign(document.createElement('span'), { className: 'h' })) : el;
    const body = heading ? heading[1] : line;
    for (const part of body.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        target.appendChild(document.createElement('strong')).textContent = part.slice(2, -2);
      } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        target.appendChild(document.createElement('code')).textContent = part.slice(1, -1);
      } else {
        target.appendChild(document.createTextNode(part));
      }
    }
    if (index < lines.length - 1) el.appendChild(document.createTextNode('\n'));
  });
}

function drawEntry(entry) {
  const sig = `${entry.kind}|${entry.state ?? ''}|${entry.color ?? ''}|${entry.text}`;
  const existing = drawn.get(entry.id);
  if (existing && existing.sig === sig) return existing.el;
  const el = existing?.el ?? document.createElement('div');
  el.className = `entry ${entry.kind}`;
  if (entry.kind === 'tool') {
    if (entry.color) el.classList.add(entry.color);
    if (entry.dim) el.classList.add('dim');
    if (entry.state === 'running') el.classList.add('running');
    el.textContent = entry.text;
    el.title = entry.text;
  } else if (entry.kind === 'assistant') {
    fillRich(el, entry.text);
  } else {
    el.textContent = entry.kind === 'user' ? entry.text : entry.text;
  }
  drawn.set(entry.id, { el, sig });
  return el;
}

function nearBottom() {
  const s = els.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 60;
}

function renderTranscript(entries) {
  const follow = nearBottom();
  const keep = new Set(entries.map((e) => e.id));
  for (const [id, { el }] of drawn) if (!keep.has(id)) { el.remove(); drawn.delete(id); }
  let previous = null;
  for (const entry of entries) {
    const el = drawEntry(entry);
    const expected = previous ? previous.nextSibling : els.transcript.firstChild;
    if (el !== expected) els.transcript.insertBefore(el, expected);
    previous = el;
  }
  if (follow) els.scroller.scrollTop = els.scroller.scrollHeight;
}

// Good morning / afternoon / evening by this computer's clock.
function greetingWord() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function renderWelcome(s) {
  // The very first question: how to address the person - never a guessed "Sir".
  const asking = !s.address;
  // After the name, a person with no AI service connects one here - never sent to the terminal.
  const connecting = !asking && s.keysChecked && !s.hasKeys;
  document.getElementById('ask-address').hidden = !asking;
  document.getElementById('choose-start').hidden = asking || connecting;
  els.greeting.textContent = asking
    ? `${greetingWord()}. Before we begin - how shall I address you?`
    : `${greetingWord()}, ${s.address}. What can I do for you?`;
  if (asking) return;
  els.projects.textContent = '';
  for (const p of s.recentProjects) {
    const b = document.createElement('button');
    b.className = 'project';
    b.appendChild(document.createTextNode(p.name));
    b.appendChild(document.createElement('small')).textContent = p.nice;
    b.addEventListener('click', () => void window.jeeves.chooseFolder(p.path));
    els.projects.appendChild(b);
  }
  els.nokeys.hidden = !s.keysChecked || s.hasKeys;
}

function renderInfo(s) {
  els.model.textContent = s.model;
  els.segments.textContent = '';
  s.segments.forEach((seg, i) => {
    if (i > 0) els.segments.appendChild(Object.assign(document.createElement('span'), { className: 'sep', textContent: '·' }));
    const span = document.createElement('span');
    span.className = `seg ${seg.color ?? ''}`;
    span.textContent = seg.text;
    els.segments.appendChild(span);
  });
}

function render(s) {
  const firstChat = state && !state.folder && s.folder;
  state = s;
  els.light.className = `light ${s.status}`;
  els.light.title = LIGHT_TITLES[s.status] ?? '';
  els.folder.textContent = s.folderName ?? '';
  els.folder.title = s.folder ?? '';
  renderInfo(s);
  document.body.classList.toggle('welcoming', !s.folder);
  if (!s.folder) {
    els.welcome.hidden = false;
    els.chat.hidden = true;
    renderWelcome(s);
    return;
  }
  els.welcome.hidden = true;
  els.chat.hidden = false;
  renderTranscript(s.transcript);

  const asking = s.approval !== null;
  els.approval.hidden = !asking;
  els.hint.hidden = asking;
  if (asking) {
    const question = [...s.transcript].reverse().find((e) => e.kind === 'tool' && e.state === 'awaiting');
    els.approvalText.textContent = question ? question.text.replace(/^\?\s*/, 'Jeeves would like to: ') : 'Jeeves would like your answer.';
    els.always.hidden = !s.approval.trustable;
  }
  els.stop.hidden = s.status !== 'working' && s.status !== 'awaiting-approval';
  els.hint.textContent = els.stop.hidden ? 'Enter to send · Shift + Enter for a new line · /undo puts the last change back' : 'Esc or the square button stops Jeeves';
  els.input.placeholder = s.status === 'working' || asking ? 'type your next message - it will be sent when I finish' : 'ask anything';
  if (firstChat) els.input.focus();
  renderBusy();
}

// "Thinking… 12s" / "Working… 3s": shown while Jeeves is busy, not asking, and not
// already writing his answer - GLM-5.3 can think for half a minute first.
function renderBusy() {
  const s = state;
  const last = s?.transcript[s.transcript.length - 1];
  const writing = last && last.kind === 'assistant' && last.text;
  const since = s?.thinkingSince ?? s?.workingSince;
  if (!s || !s.folder || s.approval || !since || writing) {
    els.busy.hidden = true;
    return;
  }
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  els.busy.textContent = `${s.thinkingSince ? 'Thinking' : 'Working'}… ${seconds}s`;
  const follow = nearBottom();
  els.busy.hidden = false;
  if (follow) els.scroller.scrollTop = els.scroller.scrollHeight;
}
setInterval(renderBusy, 1000);
// The welcome greeting follows the clock (morning, afternoon, evening) while it is open.
setInterval(() => {
  if (state && !els.welcome.hidden) renderWelcome(state);
}, 60_000);

// The typing box grows with the message up to 40% of the window, then scrolls.
function fitInput() {
  els.input.style.height = 'auto';
  els.input.style.height = `${els.input.scrollHeight}px`;
}

function send() {
  const text = els.input.value;
  if (!text.trim()) return;
  window.jeeves.send(text);
  els.input.value = '';
  fitInput();
  els.scroller.scrollTop = els.scroller.scrollHeight;
}

els.input.addEventListener('input', fitInput);
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});

// A question can be answered by button, or by Y / A / N while nothing is being typed.
els.approval.addEventListener('click', (event) => {
  const button = event.target.closest('[data-answer]');
  if (button && !button.hidden) window.jeeves.answer(button.dataset.answer);
  els.input.focus();
});

// The typing box keeps the cursor, as in Claude's app: after a button, after
// selecting text, and when the window comes back to the front. Typing anywhere
// goes into the box.
function focusInput() {
  if (!els.chat.hidden && document.getElementById('settings').hidden && !getSelection().toString()) els.input.focus();
}
window.addEventListener('focus', focusInput);
document.addEventListener('mouseup', () => setTimeout(focusInput, 0));
document.addEventListener('keydown', (event) => {
  if (els.chat.hidden || !document.getElementById('settings').hidden) return;
  const typing = document.activeElement === els.input || document.activeElement?.tagName === 'INPUT';
  if (typing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
  if (state?.approval && !els.input.value && 'yan'.includes(event.key.toLowerCase())) return;
  // The key that moves the cursor is typed too - otherwise the first letter is lost
  // (measured: typing "hi" left "i").
  event.preventDefault();
  els.input.focus();
  const end = els.input.value.length;
  els.input.setRangeText(event.key, end, end, 'end');
  fitInput();
});
document.addEventListener('keydown', (event) => {
  if (!state?.approval || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.activeElement === els.input && els.input.value) return;
  const key = event.key.toLowerCase();
  if (key === 'y' || key === 'n' || (key === 'a' && state.approval.trustable)) {
    event.preventDefault();
    window.jeeves.answer(key);
  }
});

els.stop.addEventListener('click', () => {
  window.jeeves.stop();
  els.input.focus();
});
// Esc stops the job, as in Claude Code.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state && !els.stop.hidden) {
    event.preventDefault();
    window.jeeves.stop();
  }
});

els.choose.addEventListener('click', () => void window.jeeves.chooseFolder(null));
document.getElementById('just-chat').addEventListener('click', () => void window.jeeves.chooseFolder('just-chat'));

window.jeeves.onState(render);
window.jeeves.ready().then(render);

// Choosing how to be addressed: a button, or anything typed in the box.
async function chooseAddress(value) {
  const result = await window.jeeves.setAddress(value);
  if (!result.ok) document.getElementById('address-note').textContent = result.message;
}
for (const button of document.querySelectorAll('[data-address]')) {
  button.addEventListener('click', () => void chooseAddress(button.dataset.address));
}
document.getElementById('address-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void chooseAddress(document.getElementById('address-other').value);
});

// Connecting OpenRouter from the welcome screen, with the same words as the terminal.
const connectNote = document.getElementById('welcome-connect-note');
// While waiting: the engine's own words (the same as the terminal's) and the address.
window.jeeves.onSignInUrl((waitingText) => {
  if (connectNote.dataset.waiting) connectNote.textContent = waitingText;
});
document.getElementById('welcome-sign-in').addEventListener('click', async () => {
  connectNote.className = 'note';
  connectNote.dataset.waiting = '1';
  connectNote.textContent = 'Opening your browser at OpenRouter…';
  const result = await window.jeeves.signIn();
  delete connectNote.dataset.waiting;
  connectNote.className = result.ok ? 'note good' : 'note';
  connectNote.textContent = result.message;
});
document.getElementById('welcome-key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('welcome-key');
  connectNote.className = 'note';
  connectNote.textContent = 'Checking the key…';
  const result = await window.jeeves.saveKey('openrouter', input.value);
  input.value = '';
  connectNote.className = result.ok ? 'note good' : 'note';
  connectNote.textContent = result.message;
});
