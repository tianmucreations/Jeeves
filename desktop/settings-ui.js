// The Settings panel: choose the AI service and model, manage keys, set the daily
// limit. Opened by the Settings button, by clicking the model name, or by /model or
// /keys. As in renderer.js, text is only ever placed with textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('settings');
  const servicesEl = $('services');
  const detail = $('service-detail');
  let data = null;
  let selected = null;
  let modelsCache = new Map();
  // The note under the Sign in button now on screen; the address arrives here once.
  let signInNote = null;
  // While waiting: the engine's own words (the same as the terminal's) and the address.
  window.jeeves.onSignInUrl((waitingText) => {
    if (signInNote?.dataset.waiting) signInNote.textContent = waitingText;
  });

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child) node.append(child);
    return node;
  };

  // This folder's saved conversations: click one to carry on, x to delete it.
  async function renderChats() {
    const list = await window.jeeves.conversations();
    const box = $('chats');
    box.textContent = '';
    $('chats-empty').hidden = list.length > 0;
    for (const chat of list) {
      const row = el('button', { className: 'service', title: chat.title },
        el('span', { textContent: chat.title }),
        el('small', { textContent: chat.when }));
      row.addEventListener('click', async () => {
        const result = await window.jeeves.resumeConversation(chat.id);
        if (result === 'busy') {
          $('chats-empty').hidden = false;
          $('chats-empty').textContent = 'An earlier conversation can be opened once Jeeves has finished this job.';
          return;
        }
        close();
      });
      const remove = el('small', { textContent: '×', title: 'Delete this conversation' });
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        await window.jeeves.deleteConversation(chat.id);
        await renderChats();
      });
      row.append(remove);
      box.append(row);
    }
  }

  // What has been spent, in plain lines (the same words as the terminal's).
  async function renderSpending() {
    const list = $('spending');
    list.textContent = '';
    for (const line of await window.jeeves.spending()) {
      if (line.heading) {
        list.append(el('dt', { className: 'spend-head', textContent: line.label }));
      } else {
        list.append(el('dt', { textContent: line.label }), el('dd', { textContent: line.value }));
      }
    }
  }

  // Points the folder can be put back to: click one, confirm, and it is done.
  async function renderRewind() {
    const points = await window.jeeves.rewindPoints();
    const box = $('rewind-points');
    box.textContent = '';
    $('rewind-empty').hidden = points.length > 0;
    for (const point of points) {
      const label = point.label.length > 60 ? `${point.label.slice(0, 59)}…` : point.label;
      const row = el('button', { className: 'service', title: point.label }, el('span', { textContent: `Before "${label}"` }), el('small', { textContent: point.when }));
      row.addEventListener('click', async () => {
        if (!confirm(`Put the folder back to how it was before "${label}"? Changes made after that will be undone.`)) return;
        const result = await window.jeeves.rewindTo(point.id);
        if (result === 'busy') {
          $('rewind-empty').hidden = false;
          $('rewind-empty').textContent = 'Going back works once Jeeves has finished this job.';
          return;
        }
        close();
      });
      box.append(row);
    }
  }

  // The notes Jeeves keeps about you and this folder: each has an x to remove it.
  async function renderMemory() {
    const notes = await window.jeeves.memoryNotes();
    const box = $('memory-notes');
    box.textContent = '';
    $('memory-empty').hidden = notes.length > 0;
    for (const note of notes) {
      const row = el('button', { className: 'service', title: note.text }, el('span', { textContent: note.text }), el('small', { textContent: note.about === 'me' ? 'about you' : 'this folder' }));
      const remove = el('small', { textContent: '×', title: 'Forget this' });
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        await window.jeeves.forgetNote(note.id);
        await renderMemory();
      });
      row.append(remove);
      box.append(row);
    }
  }

  async function refresh() {
    data = await window.jeeves.settings();
    void renderMemory();
    void renderRewind();
    void renderSpending();
    void renderChats();
    selected ??= data.current.provider;
    $('limit').value = data.dailyLimit.toFixed(2);
    $('address-value').value = data.address ?? '';
    renderServices();
    renderCommands();
    await renderDetail();
  }

  const allServices = () => [...data.services, ...(data.more ?? [])];

  // The full provider list, narrowed by what is typed (nothing shown until then, so the
  // short list above stays the first thing seen).
  function renderMore() {
    const box = $('more-services');
    box.textContent = '';
    const words = $('more-search').value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const service of data.more ?? []) {
      if (!words.every((word) => `${service.label} ${service.id}`.toLowerCase().includes(word))) continue;
      const row = el('button', { className: `service${service.id === selected ? ' selected' : ''}` },
        el('span', { textContent: service.label }),
        el('small', { textContent: service.ready ? (service.id === data.current.provider ? 'in use' : 'ready') : 'connect', className: service.ready ? 'ready' : '' }));
      row.addEventListener('click', () => {
        selected = service.id;
        renderServices();
        void renderDetail();
      });
      box.append(row);
    }
  }
  $('more-search').addEventListener('input', renderMore);

  function renderServices() {
    renderMore();
    servicesEl.textContent = '';
    for (const service of data.services) {
      const status = service.ready ? (service.id === data.current.provider ? 'in use' : 'ready') : service.id === 'ollama' ? 'not running' : 'connect';
      const row = el('button', { className: `service${service.id === selected ? ' selected' : ''}`, title: service.description },
        el('span', { textContent: service.label }),
        el('small', { textContent: status, className: service.ready ? 'ready' : '' }));
      row.addEventListener('click', () => {
        selected = service.id;
        renderServices();
        void renderDetail();
      });
      servicesEl.append(row);
    }
  }

  function modelRow(provider, model) {
    const current = provider === data.current.provider && model.id === data.current.model;
    const row = el('button', { className: `model-row${current ? ' current' : ''}` },
      el('span', {}, model.name, model.blurb ? el('span', { className: 'blurb', textContent: model.blurb }) : null),
      el('small', { textContent: model.price }));
    row.addEventListener('click', async () => {
      const result = await window.jeeves.chooseModel(provider, model.id);
      const note = $('model-note');
      if (result === 'busy') {
        if (note) note.textContent = 'The model can be changed once Jeeves has finished this job.';
        return;
      }
      await refresh();
    });
    return row;
  }

  async function renderDetail() {
    const service = allServices().find((s) => s.id === selected);
    detail.textContent = '';
    if (!service) return;
    detail.append(el('h3', { textContent: service.label }), el('p', { className: 'muted', textContent: service.description }));

    if (service.terminalOnly) {
      detail.append(el('p', { className: 'muted', textContent: 'Setting up another service (its address and key) is in the terminal Jeeves for now - click Settings there.' }));
      return;
    }
    if (service.id === 'ollama' && !service.ready) {
      detail.append(el('p', { className: 'muted', textContent: 'Ollama runs AI models on this computer. Start the Ollama app, then come back here.' }));
      return;
    }
    if (!service.ready) {
      renderKeyForm(service);
      return;
    }

    detail.append(el('h3', { textContent: '3. Model' }));
    const note = el('p', { className: 'note', id: 'model-note' });
    detail.append(note);
    const loading = el('p', { className: 'muted', textContent: 'Loading the models…' });
    detail.append(loading);
    let models = modelsCache.get(service.id);
    if (!models) {
      models = await window.jeeves.models(service.id);
      modelsCache.set(service.id, models);
    }
    if (selected !== service.id) return;
    loading.remove();
    if (models.note) note.textContent = models.note;
    // Recommended · All · Free, as the terminal's model menu offers them.
    const tabs = [];
    if (models.recommended.length) tabs.push(['Recommended', models.recommended]);
    if (models.all.length) tabs.push([models.recommended.length ? `All ${models.all.length}` : 'Models', models.all]);
    if (models.free?.length) tabs.push([`Free ${models.free.length}`, models.free]);
    if (!tabs.length) {
      detail.append(el('p', { className: 'muted', textContent: 'No models could be listed just now - check the internet connection and try again.' }));
    } else {
      const bar = el('div', { className: 'tabs' });
      const filter = el('input', { className: 'filter', spellcheck: false });
      const list = el('div');
      let current = tabs[0];
      const draw = () => {
        const [label, pool] = current;
        filter.hidden = pool.length <= 8;
        filter.placeholder = `Search ${pool.length} models`;
        list.textContent = '';
        const q = filter.value.trim().toLowerCase();
        const shown = pool.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)).slice(0, 80);
        if (label.startsWith('Free')) list.append(el('p', { className: 'muted', textContent: 'Free models: no charge, but OpenRouter limits requests per day.' }));
        for (const model of shown) list.append(modelRow(service.id, model));
        if (!shown.length) list.append(el('p', { className: 'muted', textContent: 'No model matches that.' }));
        for (const b of bar.children) b.classList.toggle('on', b.textContent === label);
      };
      for (const tab of tabs) {
        const b = el('button', { className: 'tab', textContent: tab[0] });
        b.addEventListener('click', () => {
          current = tab;
          filter.value = '';
          draw();
        });
        bar.append(b);
      }
      filter.addEventListener('input', draw);
      if (tabs.length > 1) detail.append(bar);
      detail.append(filter, list);
      draw();
    }

    if (service.id !== 'ollama') {
      const remove = el('button', { className: 'link', textContent: service.id === 'openai' ? 'Disconnect OpenAI (plan and key)' : `Remove the ${service.label} key from this Mac` });
      remove.addEventListener('click', async () => {
        if (!confirm(service.id === 'openai' ? 'Disconnect Jeeves from OpenAI (the ChatGPT plan and any API key)?' : `Remove the ${service.label} key from ${data.keyStore}?`)) return;
        await window.jeeves.removeKey(service.id);
        modelsCache.delete(service.id);
        await refresh();
      });
      detail.append(remove);
    }
  }

  // ChatGPT: no key at all - one button, approve in the browser.
  function renderChatGptSignIn() {
    const note = el('p', { className: 'note' });
    const signIn = el('button', { className: 'btn gold-btn', textContent: 'Sign in with ChatGPT' });
    signIn.addEventListener('click', async () => {
      note.className = 'note';
      note.textContent = 'Your browser has opened at ChatGPT. Log in, click to allow Jeeves, then come back - this moves on by itself.';
      const result = await window.jeeves.chatGptSignIn();
      note.className = result.ok ? 'note good' : 'note';
      note.textContent = result.message;
      if (result.ok) {
        modelsCache.delete('openai');
        await refresh();
      }
    });
    detail.append(
      signIn,
      el('p', { className: 'muted', textContent: 'Uses the ChatGPT Plus or Pro plan you already pay for - no key to copy and no extra bill for each use.' }),
      note,
    );
  }

  function renderKeyForm(service) {
    // OpenAI: the plan first (as OpenCode offers "ChatGPT Plus/Pro" before "API key"), then a key.
    if (service.id === 'openai') {
      renderChatGptSignIn();
      detail.append(el('p', { className: 'muted', textContent: 'Or paste an OpenAI API key (you pay OpenAI for each use):' }));
    }
    const note = el('p', { className: 'note' });
    note.style.whiteSpace = 'pre-wrap';
    note.style.overflowWrap = 'anywhere';
    const input = el('input', { type: 'password', placeholder: `Paste your ${service.label} key`, autocomplete: 'off', spellcheck: false });
    const form = el('form', { className: 'inline' }, input, el('button', { className: 'btn', textContent: 'Save key' }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      note.className = 'note';
      note.textContent = 'Checking the key…';
      const result = await window.jeeves.saveKey(service.id, input.value);
      input.value = '';
      note.className = result.ok ? 'note good' : 'note';
      note.textContent = result.message;
      if (result.ok) {
        modelsCache.delete(service.id);
        await refresh();
      }
    });
    if (service.id === 'openrouter') {
      // The recommended way first, explained - then pasting, for people who have a key.
      const signIn = el('button', { className: 'btn gold-btn', textContent: 'Sign in with OpenRouter (recommended)' });
      signIn.addEventListener('click', async () => {
        note.className = 'note';
        note.dataset.waiting = '1';
        note.textContent = 'Opening your browser at OpenRouter…';
        const result = await window.jeeves.signIn();
        delete note.dataset.waiting;
        note.className = result.ok ? 'note good' : 'note';
        note.textContent = result.message;
        if (result.ok) await refresh();
      });
      signInNote = note;
      detail.append(
        signIn,
        el('p', { className: 'muted', textContent: 'Your browser opens. Log in, or make a free account, then click Authorize and come back. No key to copy.' }),
        el('p', { className: 'muted', textContent: 'Or paste a key you already have (from openrouter.ai/keys):' }),
      );
    }
    if (service.keyPage && service.id !== 'openrouter') {
      // A link to the company's key page - no address to type out.
      const link = el('button', { className: 'link key-page', textContent: `Get your ${service.label} key at ${service.keyPage.replace(/^https:\/\//, '')}` });
      link.addEventListener('click', () => window.jeeves.openExternal(service.keyPage));
      detail.append(link);
    }
    detail.append(form, note);
    if (service.id !== 'openrouter') input.focus();
  }

  function open() {
    $('help').hidden = true;
    panel.hidden = false;
    selected = null;
    modelsCache = new Map();
    void refresh();
  }
  function close() {
    panel.hidden = true;
    window.jeeves.cancelSignIn();
  }

  $('open-settings').addEventListener('click', () => (panel.hidden ? open() : close()));
  $('model').addEventListener('click', open);
  $('close-settings').addEventListener('click', close);
  // The commands as plain buttons (from the one table of commands), so nobody has to know them.
  function renderCommands() {
    // Two places, as the terminal's Settings has them: Conversations, and More.
    const boxes = { conversation: $('commands-conversation'), more: $('commands') };
    boxes.conversation.textContent = '';
    boxes.more.textContent = '';
    for (const entry of data.commands ?? []) {
      const button = el('button', { className: 'service' }, el('span', { textContent: entry.label }), el('small', { textContent: entry.description }));
      button.addEventListener('click', () => {
        close();
        window.jeeves.send(entry.command);
      });
      (boxes[entry.place] ?? boxes.more).append(button);
    }
    // Step 1: the folder Jeeves is working in; clicking it goes to the folder choice.
    $('folder-step-name').textContent = data.folderName ?? 'Just chatting';
  }
  $('folder-step').addEventListener('click', () => {
    close();
    window.jeeves.changeFolder();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopImmediatePropagation();
      close();
    }
  }, true);
  window.jeeves.onOpenSettings(open);

  // Help: the same kind of panel, from the Help button or /help.
  const help = $('help');
  const openHelp = async () => {
    close();
    help.hidden = false;
    // The buttons under Settings, listed from the one table of commands.
    const list = $('help-commands');
    list.textContent = '';
    for (const entry of (await window.jeeves.settings()).commands ?? []) {
      list.append(el('dt', { textContent: entry.label }), el('dd', { textContent: entry.description }));
    }
  };
  $('open-help').addEventListener('click', () => (help.hidden ? openHelp() : (help.hidden = true)));
  $('close-help').addEventListener('click', () => (help.hidden = true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !help.hidden) {
      event.stopImmediatePropagation();
      help.hidden = true;
    }
  }, true);
  window.jeeves.onOpenHelp(openHelp);
  window.jeeves.onSettingsChanged(() => {
    if (!panel.hidden) void refresh();
  });

  $('address-setting').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.jeeves.setAddress($('address-value').value);
    $('address-setting-note').className = result.ok ? 'note good' : 'note';
    $('address-setting-note').textContent = result.message;
  });

  $('limit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.jeeves.setLimit($('limit').value);
    $('limit-note').className = result.ok ? 'note good' : 'note';
    $('limit-note').textContent = result.message;
  });
})();
