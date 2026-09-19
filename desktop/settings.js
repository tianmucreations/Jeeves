// Settings in the window: the AI service, its model, keys and the daily limit.
// Every step is the terminal Jeeves's own (ModelPicker.tsx applyModel, KeysManager.tsx
// saveKey), called from the same engine, so both ways of using Jeeves behave alike.
import { ipcMain } from 'electron';

export async function registerSettings(engine, onChange) {
  const { session } = await engine('state/session.js');
  const providers = await engine('providers/index.js');
  const config = await engine('platform/config.js');
  const registry = await engine('models/registry.js');
  const { isToolCapable } = await engine('models/filter.js');
  const { isDirectService, directService, CUSTOM_SERVICE_ID } = await engine('providers/direct-services.js');
  const { loadDirectModels } = await engine('providers/catalogue.js');
  const { autoRowFor, noAutoNote } = await engine('agent/auto.js');
  const { ZAI_MODELS } = await engine('providers/zai.js');
  const { listLocalOllamaModels, isOllamaOnline } = await engine('providers/ollama.js');
  const { keyLooksValid } = await engine('commands/keys.js');
  const { signInWithOpenRouter } = await engine('providers/openrouter-signin.js');

  const labelOf = (id) => providers.PROVIDER_ROWS.find((row) => row.id === id)?.label ?? id;
  const row = (model, blurb = '') => ({
    id: model.id,
    name: registry.cleanModelName(model.name ?? model.id),
    price: registry.compactPrice(model.promptPrice ?? 0, model.completionPrice ?? 0, model.priceLabel),
    blurb,
    free: registry.isFreeModel(model),
  });

  ipcMain.handle('settings', async () => ({
    services: await Promise.all(
      providers.PROVIDER_ROWS.map(async (service) => ({
        ...service,
        ready: service.id === 'ollama' ? await isOllamaOnline().catch(() => false) : providers.hasCredentialsFor(service.id),
        // The address-and-key setup for "Other service" stays in the terminal for now.
        terminalOnly: service.id === CUSTOM_SERVICE_ID && !providers.hasCredentialsFor(service.id),
      })),
    ),
    current: { provider: session.providerId, model: session.model },
    dailyLimit: session.dailyLimit,
    address: config.getAddress(),
    busy: session.status === 'working' || session.status === 'awaiting-approval',
  }));

  // The models a service offers: the recommended few first where the list is long.
  ipcMain.handle('models', async (_event, provider) => {
    const note = noAutoNote(provider, labelOf(provider));
    if (provider === 'openrouter') {
      const recommended = registry.resolveCurated(session.models).map((pick) => row(pick.model, pick.blurb));
      const all = session.models.map((model) => row(model));
      // As the terminal's "free" tab (ModelPicker poolFor): free models that can
      // also do tasks - a free model that can only chat is no use here.
      const free = session.models.filter((model) => registry.isFreeModel(model) && isToolCapable(model)).map((model) => row(model));
      return { recommended, all, free, note };
    }
    if (provider === 'zai') return { recommended: [], all: ZAI_MODELS.map((model) => row(model)), note };
    if (provider === 'ollama') return { recommended: [], all: (await listLocalOllamaModels().catch(() => [])).map((model) => row(model)), note };
    if (isDirectService(provider)) {
      const models = await loadDirectModels(provider, providers.serviceKey(provider) ?? '').catch(() => []);
      const auto = autoRowFor(provider, models);
      return { recommended: auto ? [row(auto)] : [], all: models.map((model) => row(model)), note };
    }
    return { recommended: [], all: [], note };
  });

  // ModelPicker.tsx applyModel, step for step.
  ipcMain.handle('choose-model', (_event, provider, modelId) => {
    if (session.status === 'working' || session.status === 'awaiting-approval') return 'busy';
    session.setProvider(provider);
    session.setModel(modelId);
    config.setDefaultProvider(provider);
    config.setDefaultModel(modelId);
    const recents = [modelId, ...session.recents.filter((id) => id !== modelId)].slice(0, 10);
    session.setRecents(recents);
    config.setRecents(recents);
    session.setStatus(providers.hasCredentials() ? 'idle' : 'disconnected');
    void providers.refreshCredit();
    // A direct connection's prices and memory sizes load in the background (app.tsx).
    if (isDirectService(provider)) void loadDirectModels(provider, providers.serviceKey(provider) ?? '').catch(() => {});
    onChange();
    return 'ok';
  });

  // KeysManager.tsx saveKey: the same checks and the same plain answers.
  ipcMain.handle('save-key', async (_event, provider, rawKey) => {
    const key = String(rawKey ?? '').trim();
    if (!keyLooksValid(key, provider)) {
      return provider === 'openrouter'
        ? { ok: false, message: 'That does not look like an OpenRouter key (they start with sk-or-) - paste it again.' }
        : { ok: false, message: 'That looks too short to be a key - paste it again.' };
    }
    if (provider === 'openrouter' || provider === 'zai') {
      const saved = provider === 'openrouter' ? await providers.storeOpenRouterKey(key) : await providers.storeZaiKey(key);
      onChange();
      return saved ? { ok: true, message: 'Your key is saved securely in your Mac keychain.' } : { ok: false, message: 'The Mac keychain was not reachable - try again.' };
    }
    if (isDirectService(provider)) {
      const label = directService(provider).label;
      const result = await providers.storeDirectKey(provider, key);
      onChange();
      if (result === 'rejected') return { ok: false, message: `${label} didn't accept that key - paste it again.` };
      if (result === 'keychain') return { ok: false, message: 'The Mac keychain was not reachable - try again.' };
      const unchecked = result === 'saved-unchecked' ? ` ${label} couldn't be reached to check it just now.` : '';
      return { ok: true, message: `Your ${label} key is saved securely in your Mac keychain.${unchecked}` };
    }
    return { ok: false, message: 'Set this one up in the terminal Jeeves for now.' };
  });

  ipcMain.handle('remove-key', async (_event, provider) => {
    if (provider === 'openrouter') await providers.removeOpenRouterKey();
    else await providers.removeServiceKey(provider);
    if (session.providerId === provider) session.setStatus('disconnected');
    onChange();
    return true;
  });

  // "Sign in with OpenRouter": approve Jeeves in the browser, no key to copy.
  let signingIn = null;
  ipcMain.handle('openrouter-sign-in', async () => {
    signingIn?.abort();
    signingIn = new AbortController();
    const result = await signInWithOpenRouter({ signal: signingIn.signal });
    signingIn = null;
    if (!result.ok) {
      return { ok: false, message: result.reason === 'cancelled' ? '' : result.reason === 'timeout' ? 'No approval arrived - try again, or paste a key.' : "OpenRouter didn't complete the sign-in - try again, or paste a key." };
    }
    const saved = await providers.storeOpenRouterKey(result.key);
    onChange();
    return saved ? { ok: true, message: 'Signed in - your OpenRouter key is saved in your Mac keychain.' } : { ok: false, message: 'The Mac keychain was not reachable - try again.' };
  });
  ipcMain.on('openrouter-sign-in-cancel', () => signingIn?.abort());

  ipcMain.handle('set-limit', (_event, raw) => {
    const value = Number(String(raw).trim().replace(/^\$/, ''));
    if (!Number.isFinite(value) || value <= 0 || value > 1000) return { ok: false, message: 'Type an amount in dollars, like 3 or 7.50' };
    const rounded = Math.round(value * 100) / 100;
    session.setDailyLimit(rounded);
    config.setDailyLimit(rounded);
    onChange();
    return { ok: true, message: `Daily limit set to $${rounded.toFixed(2)}.` };
  });
}
