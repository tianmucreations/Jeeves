// Plain-English key helpers; the interactive screens live in KeysManager.

export function keyLooksValid(key: string, provider: string): boolean {
  const trimmed = key.trim();
  if (provider === 'openrouter' || provider === 'openrouter-management') {
    return trimmed.startsWith('sk-or-') && trimmed.length >= 20;
  }
  return trimmed.length >= 20;
}

export function describeKeySource(source: 'keychain' | 'env' | null): string {
  if (source === 'keychain') return 'key stored in your Mac keychain';
  if (source === 'env') return 'key in a local file - add it with /keys to store it safely';
  return 'no key';
}