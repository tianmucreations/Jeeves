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

  async function refresh() {
    data = await window.jeeves.settings();
    selected ??= data.current.provider;
    $('limit').value = data.dailyLimit.toFixed(2);
    $('address-value').value = data.address ?? '';
    renderServices();
    await renderDetail();
  }

  function renderServices() {
    servicesEl.textContent = '';
    for (const service of data.services) {
      const status = service.ready ? (service.id === data.current.provider ? 'in use' : 'ready') : service.id === 'ollama' ? 'not running' : 'add a key';
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
    const service = data.services.find((s) => s.id === selected);
    detail.textContent = '';
    if (!service) return;
    detail.append(el('h3', { textContent: service.label }), el('p', { className: 'muted', textContent: service.description }));

    if (service.terminalOnly) {
      detail.append(el('p', { className: 'muted', textContent: 'Setting up another service (its address and key) is in the terminal Jeeves for now - type /model there.' }));
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
      const remove = el('button', { className: 'link', textContent: `Remove the ${service.label} key from this Mac` });
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove the ${service.label} key from your Mac keychain?`)) return;
        await window.jeeves.removeKey(service.id);
        modelsCache.delete(service.id);
        await refresh();
      });
      detail.append(remove);
    }
  }

  function renderKeyForm(service) {
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
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopImmediatePropagation();
      close();
    }
  }, true);
  window.jeeves.onOpenSettings(open);

  // Help: the same kind of panel, from the Help button or /help.
  const help = $('help');
  const openHelp = () => {
    close();
    help.hidden = false;
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
