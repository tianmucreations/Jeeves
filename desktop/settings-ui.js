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

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child) node.append(child);
    return node;
  };

  async function refresh() {
    data = await window.jeeves.settings();
    selected ??= data.current.provider;
    $('limit').value = data.dailyLimit.toFixed(2);
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
    if (models.recommended.length) {
      detail.append(el('p', { className: 'muted', textContent: 'Recommended' }));
      for (const model of models.recommended) detail.append(modelRow(service.id, model));
    }
    if (models.all.length) {
      const list = el('div');
      const draw = (query) => {
        list.textContent = '';
        const q = query.trim().toLowerCase();
        const shown = models.all.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)).slice(0, 80);
        for (const model of shown) list.append(modelRow(service.id, model));
        if (!shown.length) list.append(el('p', { className: 'muted', textContent: 'No model matches that.' }));
      };
      if (models.all.length > 8) {
        const filter = el('input', { className: 'filter', placeholder: `Search all ${models.all.length} models`, spellcheck: false });
        filter.addEventListener('input', () => draw(filter.value));
        detail.append(el('p', { className: 'muted', textContent: models.recommended.length ? 'All models' : '' }), filter);
      }
      detail.append(list);
      draw('');
    } else if (!models.recommended.length) {
      detail.append(el('p', { className: 'muted', textContent: "No models could be listed just now - check the internet connection and try again." }));
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
    detail.append(form);
    if (service.id === 'openrouter') {
      const signIn = el('button', { className: 'btn gold-btn', textContent: 'Sign in with OpenRouter' });
      signIn.style.marginTop = '12px';
      signIn.addEventListener('click', async () => {
        note.className = 'note';
        note.textContent = 'Your browser is opening - approve Jeeves on OpenRouter, then come back here.';
        const result = await window.jeeves.signIn();
        note.className = result.ok ? 'note good' : 'note';
        note.textContent = result.message;
        if (result.ok) await refresh();
      });
      detail.append(el('p', { className: 'muted', textContent: 'Or, with no key to copy:' }), signIn);
    }
    detail.append(note);
    input.focus();
  }

  function open() {
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
  window.jeeves.onSettingsChanged(() => {
    if (!panel.hidden) void refresh();
  });

  $('limit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.jeeves.setLimit($('limit').value);
    $('limit-note').className = result.ok ? 'note good' : 'note';
    $('limit-note').textContent = result.message;
  });
})();
