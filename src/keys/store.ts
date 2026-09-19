// API keys live in the operating system's own credential store (the macOS Keychain),
// never in plain files. The library loads lazily so a missing native module degrades
// gracefully instead of crashing the app.
//
// On a Mac, Jeeves uses Apple's own `security` program, as Claude Code does
// (src/utils/secureStorage/macOsKeychainStorage.ts): no add-on to break. keytar is
// archived (unmaintained since Dec 2022) and inside the desktop app it crashed on
// quit whenever a keychain read was still running - 10 of 10 times (19 Sept). The
// Keychain items are the same ones keytar made (service "jeeves", account = the
// service id), so nobody re-enters a key: checked 19 Sept - an item keytar created
// was updated, read, listed and deleted by `security` with no permission box.
// Windows and Linux stay on keytar until the same check is done there.
import { execFile } from 'node:child_process';
type Keytar = typeof import('keytar');

// JEEVES_KEYCHAIN_SERVICE lets a test run use its own keychain entries, never the real ones.
const SERVICE = process.env.JEEVES_KEYCHAIN_SERVICE || 'jeeves';

let cached: Keytar | null = null;

function runSecurity(args: string[], input?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile('/usr/bin/security', args, { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout) });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

// Quotes a value for one line of `security -i`: the ids are plain words, but never trust that.
const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

const macKeychain = {
  async setPassword(service: string, account: string, password: string): Promise<void> {
    // The key goes in as hex on standard input, so it never appears in the list of
    // running programs (Claude Code's reason: process monitors see only "security -i").
    const hex = Buffer.from(password, 'utf8').toString('hex');
    const { code } = await runSecurity(['-i'], `add-generic-password -U -s ${quoted(service)} -a ${quoted(account)} -X "${hex}"\n`);
    if (code !== 0) throw new Error('The Mac keychain did not save the key.');
  },
  async getPassword(service: string, account: string): Promise<string | null> {
    // Exit 44 is "no such item" - a real "no key". Any other failure (a timeout, a
    // busy keychain) is asked once more rather than taken as "no key" (Claude Code
    // treats a timed-out read as "may have a key" for the same reason).
    for (let attempt = 0; attempt < 2; attempt++) {
      const { code, stdout } = await runSecurity(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (code === 0) return stdout.replace(/\n$/, '') || null;
      if (code === 44) return null;
    }
    return null;
  },
  async deletePassword(service: string, account: string): Promise<boolean> {
    const { code } = await runSecurity(['delete-generic-password', '-s', service, '-a', account]);
    return code === 0;
  },
  // Names only: dump-keychain without -d lists what is saved, never the keys themselves.
  async findCredentials(service: string): Promise<{ account: string; password: string }[]> {
    const { stdout } = await runSecurity(['dump-keychain']);
    const accounts: { account: string; password: string }[] = [];
    for (const block of stdout.split('keychain: ')) {
      if (!block.includes(`"svce"<blob>="${service}"`)) continue;
      const account = /"acct"<blob>="([^"]*)"/.exec(block)?.[1];
      if (account) accounts.push({ account, password: '' });
    }
    return accounts;
  },
};

async function load(): Promise<Keytar | null> {
  // Escape hatch for automated tests so they never touch the real credential store.
  if (process.env.JEEVES_SKIP_KEYCHAIN === '1') return null;
  if (cached === null) {
    if (process.platform === 'darwin') {
      cached = macKeychain as unknown as Keytar;
    } else {
      const mod = await import('keytar');
      cached = (mod.default ?? mod) as Keytar;
    }
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