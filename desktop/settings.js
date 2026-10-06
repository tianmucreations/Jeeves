// Settings in the window: the AI service, its model, keys and the daily limit.
// Every step is the terminal Jeeves's own (ModelPicker.tsx applyModel, KeysManager.tsx
// saveKey), called from the same engine, so both ways of using Jeeves behave alike.
import { ipcMain } from 'electron';
import path from 'node:path';

export async function registerSettings(engine, onChange, notify = () => {}) {
  const { session } = await engine('state/session.js');
  const providers = await engine('providers/index.js');
  const config = await engine('platform/config.js');
  const registry = await engine('models/registry.js');
  const { isToolCapable } = await engine('models/filter.js');
  const { isModelUnreliable } = await engine('agent/model-health.js');
  const { isDirectService, directService, compatibleServices, CUSTOM_SERVICE_ID } = await engine('providers/direct-services.js');
  const { loadDirectModels, loadCatalogue } = await engine('providers/catalogue.js');
  const { autoRowFor, noAutoNote } = await engine('agent/auto.js');
  const { ZAI_MODELS } = await engine('providers/zai.js');
  const { listLocalOllamaModels, isOllamaOnline } = await engine('providers/ollama.js');
  const { keyLooksValid } = await engine('commands/keys.js');
  const { signInWithOpenRouter, WAITING_STEPS } = await engine('providers/openrouter-signin.js');
  const { noCreditNote } = await engine('providers/openrouter.js');
  const { signInWithChatGpt } = await engine('providers/chatgpt.js');

  const chats = await engine('platform/conversations.js');
  const { COMMANDS } = await engine('commands/help.js');
  const memory = await engine('platform/memory.js');
  const checkpoints = await engine('checkpoints/index.js');
  const { chatFolder: chatFolderPath } = await engine('platform/chat-folder.js');
  const { spendingLines } = await engine('commands/spending.js');
  const { KEY_STORE, KEY_STORE_SUBJECT } = await engine('platform/wording.js');

  // Earlier conversations of the folder in use, as the terminal's list shows them.
  ipcMain.handle('conversations', () => chats.listConversations().map((chat) => ({ id: chat.id, title: chat.title, when: chats.ago(chat.updated) })));
  // What Jeeves remembers (the terminal's "What I remember"): each note can be removed.
  // Going back to an earlier point (the terminal's "Go back to an earlier point").
  ipcMain.handle('rewind-points', async () => (await checkpoints.rewindPoints()).map((point) => ({ id: point.id, label: point.label, when: chats.ago(point.createdAt) })));
  ipcMain.handle('rewind-to', async (_event, id) => {
    if (session.status === 'working' || session.approvalPending) return 'busy';
    const outcome = await checkpoints.rewindTo(String(id));
    session.addNotice(outcome.message);
    if (outcome.historyNote) session.pendingContextNote = outcome.historyNote;
    onChange();
    return 'ok';
  });
  // What has been spent, in the same plain lines as the terminal's "What I've spent".
  ipcMain.handle('spending', () => spendingLines());
  ipcMain.handle('memory-notes', () => memory.allNotes().map((note) => ({ id: note.id, text: note.text, about: note.about })));
  ipcMain.handle('forget-note', (_event, id) => {
    memory.removeNote(String(id));
    return true;
  });
  ipcMain.handle('resume-conversation', (_event, id) => {
    if (session.status === 'working' || session.approvalPending) return 'busy';
    const ok = chats.resumeConversation(String(id));
    session.addNotice(ok ? 'Carrying on from where we stopped - go ahead.' : "That conversation couldn't be opened - it may have been damaged.");
    onChange();
    return ok ? 'ok' : 'failed';
  });
  ipcMain.handle('delete-conversation', (_event, id) => {
    chats.deleteConversation(String(id));
    return true;
  });

  const labelOf = (id) => providers.PROVIDER_ROWS.find((row) => row.id === id)?.label ?? id;
  const row = (model, blurb = '') => ({
    id: model.id,
    name: registry.cleanModelName(model.name ?? model.id),
    price: registry.compactPrice(model.promptPrice ?? 0, model.completionPrice ?? 0, model.priceLabel),
    blurb,
    free: registry.isFreeModel(model),
  });

  ipcMain.handle('settings', async () => ({
    // The other AI companies come from the public list; on the very first opening, wait a few
    // seconds for it (a day's copy is kept after that).
    _catalogue: await Promise.race([loadCatalogue().then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 4000))]),
    services: await Promise.all(
      providers.PROVIDER_ROWS.map(async (service) => ({
        ...service,
        ready: service.id === 'ollama' ? await isOllamaOnline().catch(() => false) : providers.hasCredentialsFor(service.id),
        // The address-and-key setup for "Other provider" stays in the terminal for now.
        terminalOnly: service.id === CUSTOM_SERVICE_ID && !providers.hasCredentialsFor(service.id),
        // Where to get a key (checked 19 Sept: Z.ai's page answers, a made-up one is "not found").
        keyPage: isDirectService(service.id) ? `https://${directService(service.id).keyPage}` : service.id === 'zai' ? 'https://z.ai/manage-apikey/apikey-list' : service.id === 'openrouter' ? 'https://openrouter.ai/keys' : null,
      })),
    ),
    // Every other AI company in the public catalogue (OpenCode's "Providers" list).
    more: compatibleServices().map((service) => ({
      id: service.id,
      label: service.label,
      description: 'API key',
      ready: providers.hasCredentialsFor(service.id),
      keyPage: `https://${service.keyPage}`,
    })),
    keyStore: KEY_STORE,
    // The buttons under "More", from the one table of commands (the same as the terminal's Settings).
    commands: COMMANDS.filter((entry) => entry.place).map(({ command, label, description, place }) => ({ command, label, description, place })),
    // Step 1: where Jeeves is working now.
    folderName: process.cwd() === chatFolderPath() ? 'Just chatting' : path.basename(process.cwd()),
    current: { provider: providers.rowFor(session.providerId), model: session.model },
    dailyLimit: session.dailyLimit,
    address: config.getAddress(),
    busy: session.status === 'working' || session.status === 'awaiting-approval',
  }));

  // The models a service offers: the recommended few first where the list is long.
  ipcMain.handle('models', async (_event, rowId) => {
    // OpenAI's row runs on the ChatGPT plan or the API key, whichever is connected.
    const provider = providers.serviceFor(rowId);
    const note = noAutoNote(provider, labelOf(provider));
    if (provider === 'openrouter') {
      const recommended = registry.resolveCurated(session.models).map((pick) => row(pick.model, pick.blurb));
      const all = session.models.map((model) => row(model));
      // As the terminal's "free" tab (ModelPicker poolFor): free models that can
      // also do tasks - a free model that can only chat is no use here.
      const free = session.models.filter((model) => registry.isFreeModel(model) && isToolCapable(model) && !isModelUnreliable(model.id)).map((model) => row(model));
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
  ipcMain.handle('choose-model', (_event, rowId, modelId) => {
    const provider = providers.serviceFor(rowId);
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
      if (!saved) return { ok: false, message: `${KEY_STORE_SUBJECT} was not reachable - try again.` };
      const credit = provider === 'openrouter' ? await noCreditNote(key) : '';
      return { ok: true, message: `Your key is saved securely in ${KEY_STORE}.${credit ? ' ' + credit : ''}` };
    }
    if (isDirectService(provider)) {
      const label = directService(provider).label;
      const result = await providers.storeDirectKey(provider, key);
      onChange();
      if (result === 'rejected') return { ok: false, message: `${label} didn't accept that key - paste it again.` };
      if (result === 'keychain') return { ok: false, message: `${KEY_STORE_SUBJECT} was not reachable - try again.` };
      const unchecked = result === 'saved-unchecked' ? ` ${label} couldn't be reached to check it just now.` : '';
      return { ok: true, message: `Your ${label} key is saved securely in ${KEY_STORE}.${unchecked}` };
    }
    return { ok: false, message: 'Set this one up in the terminal Jeeves for now.' };
  });

  ipcMain.handle('remove-key', async (_event, provider) => {
    if (provider === 'openrouter') await providers.removeOpenRouterKey();
    else {
      await providers.removeServiceKey(provider);
      // OpenAI's row covers both ways of connecting: removing it signs out of the plan too.
      if (provider === 'openai') await providers.removeServiceKey('chatgpt');
    }
    if (session.providerId === provider) session.setStatus('disconnected');
    onChange();
    return true;
  });

  // "Sign in with OpenRouter": approve Jeeves in the browser, no key to copy.
  let signingIn = null;
  ipcMain.handle('openrouter-sign-in', async () => {
    signingIn?.abort();
    signingIn = new AbortController();
    // The address goes to the window too, in case the browser did not open.
    const result = await signInWithOpenRouter({ signal: signingIn.signal, onUrl: (url) => notify('sign-in-url', `${WAITING_STEPS.join('\n')}\n\nBrowser didn't open? Go to: ${url}`) });
    signingIn = null;
    if (!result.ok) {
      return { ok: false, message: result.reason === 'cancelled' ? '' : result.reason === 'timeout' ? 'No approval arrived after fifteen minutes, so I stopped waiting - try again, or paste a key.' : "OpenRouter didn't complete the sign-in - try again, or paste a key." };
    }
    const saved = await providers.storeOpenRouterKey(result.key);
    onChange();
    if (!saved) return { ok: false, message: `${KEY_STORE_SUBJECT} was not reachable - try again.` };
    const credit = await noCreditNote(result.key);
    return { ok: true, message: `Signed in - your OpenRouter key is saved in ${KEY_STORE}.${credit ? ' ' + credit : ''}` };
  });
  ipcMain.on('openrouter-sign-in-cancel', () => signingIn?.abort());

  // "Sign in with ChatGPT": approve in the browser, no key (the terminal's ChatGptConnect).
  let chatGptSigningIn = null;
  ipcMain.handle('chatgpt-sign-in', async () => {
    chatGptSigningIn?.abort();
    chatGptSigningIn = new AbortController();
    const result = await signInWithChatGpt({ signal: chatGptSigningIn.signal });
    chatGptSigningIn = null;
    if (!result.ok) {
      const message =
        result.reason === 'cancelled'
          ? ''
          : result.reason === 'timeout'
            ? 'No approval arrived after five minutes, so I stopped waiting - press the button to try again.'
            : result.reason === 'busy'
              ? 'Another program (such as the ChatGPT Codex app) is using the sign-in door. Close it and try again.'
              : "ChatGPT didn't complete the sign-in - press the button to try again.";
      return { ok: false, message };
    }
    const saved = await providers.storeChatGptTokens(result.tokens);
    onChange();
    if (!saved) return { ok: false, message: `${KEY_STORE_SUBJECT} was not reachable - try again.` };
    return { ok: true, message: `Connected - Jeeves will use your ChatGPT plan. The sign-in is saved securely in ${KEY_STORE}.` };
  });
  ipcMain.on('chatgpt-sign-in-cancel', () => chatGptSigningIn?.abort());

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
