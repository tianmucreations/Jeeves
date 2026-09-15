// API keys live in the operating system's own credential store (the macOS Keychain),
// never in plain files. The library loads lazily so a missing native module degrades
// gracefully instead of crashing the app.
type Keytar = typeof import('keytar');

const SERVICE = 'jeeves';

let cached: Keytar | null = null;

async function load(): Promise<Keytar | null> {
  // Escape hatch for automated tests so they never touch the real credential store.
  if (process.env.JEEVES_SKIP_KEYCHAIN === '1') return null;
  if (cached === null) {
    const mod = await import('keytar');
    cached = (mod.default ?? mod) as Keytar;
  }
  return cached;
}

export async function setKey(provider: string, key: string): Promise<boolean> {
  try {
    const keytar = await load();
    if (!keytar) return false;
    await keytar.setPassword(SERVICE, provider, key);
    return true;
  } catch {
    return false;
  }
}

export async function getKey(provider: string): Promise<string | null> {
  try {
    const keytar = await load();
    if (!keytar) return null;
    return await keytar.getPassword(SERVICE, provider);
  } catch {
    return null;
  }
}

export async function deleteKey(provider: string): Promise<boolean> {
  try {
    const keytar = await load();
    if (!keytar) return false;
    return await keytar.deletePassword(SERVICE, provider);
  } catch {
    return false;
  }
}

export async function listProviders(): Promise<string[]> {
  try {
    const keytar = await load();
    if (!keytar) return [];
    const credentials = await keytar.findCredentials(SERVICE);
    return credentials.map((credential) => credential.account);
  } catch {
    return [];
  }
}