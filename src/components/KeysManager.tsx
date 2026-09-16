import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session, useSession } from '../state/session.js';
import {
  PROVIDER_ROWS,
  storeOpenRouterKey,
  removeOpenRouterKey,
  storeZaiKey,
  removeZaiKey,
  storedKeyProviders,
  getKeySource,
  refreshCredit,
} from '../providers/index.js';
import { setKey, deleteKey } from '../keys/store.js';
import { keyLooksValid } from '../commands/keys.js';

// The keys screen shows one extra row the model picker does not: the optional
// OpenRouter management key, which unlocks the real account balance.
const KEY_ROWS = [
  PROVIDER_ROWS[0],
  { id: 'openrouter-management', label: 'OpenRouter (account)' },
  ...PROVIDER_ROWS.slice(1),
];

type Phase =
  | { kind: 'ask' }
  | { kind: 'list' }
  | { kind: 'enter-key'; provider: string; label: string }
  | { kind: 'confirm-remove'; provider: string; label: string }
  | { kind: 'saved'; message: string };

function rowLabel(id: string): string {
  return KEY_ROWS.find((row) => row.id === id)?.label ?? id;
}

export function KeysManager({ mode, rows, columns }: { mode: 'wizard' | 'manage'; rows: number; columns: number }) {
  const s = useSession();
  const [phase, setPhase] = useState<Phase>(mode === 'wizard' ? { kind: 'ask' } : { kind: 'list' });
  const [cursor, setCursor] = useState(0);
  const [hidden, setHidden] = useState('');
  const [stored, setStored] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const refreshStored = useCallback(() => {
    void storedKeyProviders().then((names) => setStored(names));
  }, []);

  useEffect(() => {
    refreshStored();
  }, [refreshStored]);

  function statusFor(rowId: string): string {
    if (rowId === 'openrouter') {
      if (getKeySource() === 'keychain') return 'key stored in your Mac keychain';
      if (getKeySource() === 'env') return 'key in the .env development file';
      return stored.includes('openrouter') ? 'key stored in your Mac keychain' : 'no key';
    }
    if (rowId === 'openrouter-management') {
      return stored.includes('openrouter-management')
        ? 'management key stored - real account balance'
        : 'optional - unlocks your real account balance';
    }
    if (rowId === 'zai') {
      return stored.includes('zai') ? 'key stored - GLM Coding Plan ready' : 'no key - add one to use the flat plan';
    }
    if (rowId === 'ollama') return 'local - no key needed';
    return stored.includes(rowId) ? 'key saved - direct connection coming' : 'add key with /keys';
  }

  function finishWizard(message: string, connected: boolean): void {
    if (connected) {
      session.addNotice(message);
      if (session.status === 'disconnected') session.setStatus('idle');
      void refreshCredit();
    } else {
      session.addNotice(message);
    }
    session.endWizard();
  }

  async function saveKey(provider: string, key: string): Promise<void> {
    if (provider === 'openrouter') {
      const saved = await storeOpenRouterKey(key);
      if (!saved) {
        setNote('The Mac keychain was not reachable - press Enter and try again.');
        return;
      }
      refreshStored();
      const message = 'Your key is saved securely in your Mac keychain. You will not be asked for it again.';
      if (mode === 'wizard') {
        finishWizard(message, true);
      } else {
        setPhase({ kind: 'saved', message });
      }
      return;
    }
    if (provider === 'zai') {
      const saved = await storeZaiKey(key);
      if (!saved) {
        setNote('The Mac keychain was not reachable - press Enter and try again.');
        return;
      }
      refreshStored();
      const message = 'Your Z.ai key is saved. Pick Z.ai in /model to use the GLM Coding Plan.';
      if (mode === 'wizard') {
        finishWizard(message, true);
      } else {
        setPhase({ kind: 'saved', message });
      }
      return;
    }
    const saved = await setKey(provider, key);
    if (!saved) {
      setNote('The Mac keychain was not reachable - press Enter and try again.');
      return;
    }
    refreshStored();
    if (provider === 'openrouter-management') {
      void refreshCredit();
      const message = 'Management key saved - the info bar now shows your real account balance.';
      if (mode === 'wizard') {
        finishWizard(message, false);
      } else {
        setPhase({ kind: 'saved', message });
      }
      return;
    }
    const message = `Key saved for ${rowLabel(provider)} - direct connections arrive in a coming update.`;
    if (mode === 'wizard') {
      finishWizard(message, false);
    } else {
      setPhase({ kind: 'saved', message });
    }
  }

  async function removeKey(provider: string): Promise<void> {
    if (provider === 'openrouter') {
      const fallback = await removeOpenRouterKey();
      refreshStored();
      const message =
        fallback === 'env'
          ? 'The key was removed from your keychain - the .env development key is still active.'
          : 'The key was removed. You are signed out until a new key is added.';
      if (fallback !== 'env') session.setStatus('disconnected');
      setPhase({ kind: 'saved', message });
      return;
    }
    if (provider === 'zai') {
      await removeZaiKey();
      refreshStored();
      setPhase({ kind: 'saved', message: 'The Z.ai key was removed. The GLM Coding Plan needs a key to work.' });
      return;
    }
    if (provider === 'openrouter-management') {
      await deleteKey(provider);
      refreshStored();
      void refreshCredit();
      setPhase({ kind: 'saved', message: 'The management key was removed - the info bar shows the key cap again.' });
      return;
    }
    await deleteKey(provider);
    refreshStored();
    setPhase({ kind: 'saved', message: `The saved key for ${rowLabel(provider)} was removed.` });
  }

  useInput((input, key) => {
    if (phase.kind === 'ask') {
      const answer = input.toLowerCase();
      if (answer === 'y') {
        setCursor(0);
        setPhase({ kind: 'list' });
      } else if (answer === 'n') {
        finishWizard('No key for now - you can add one any time with /keys.', false);
      }
      return;
    }
    if (phase.kind === 'saved') {
      if (input || key.return || key.escape) {
        setPhase({ kind: 'list' });
        setNote('');
      }
      return;
    }
    if (phase.kind === 'confirm-remove') {
      const answer = input.toLowerCase();
      if (answer === 'y') {
        void removeKey(phase.provider);
      } else if (answer === 'n' || key.escape) {
        setPhase({ kind: 'list' });
        setNote('');
      }
      return;
    }
    if (phase.kind === 'enter-key') {
      if (key.escape) {
        setPhase({ kind: 'list' });
        setNote('');
        setHidden('');
        return;
      }
      if (key.return) {
        const trimmed = hidden.trim();
        if (!keyLooksValid(trimmed, phase.provider)) {
          setNote(
            phase.provider === 'openrouter'
              ? 'That does not look like an OpenRouter key (they start with sk-or-) - paste it again, or press Esc to go back.'
              : 'That looks too short to be a key - paste it again, or press Esc to go back.'
          );
          setHidden('');
          return;
        }
        const provider = phase.provider;
        const label = phase.label;
        setHidden('');
        setNote('');
        void saveKey(provider, trimmed);
        setPhase({ kind: 'list' });
        void label;
        return;
      }
      if (key.backspace || key.delete) {
        setHidden((current) => current.slice(0, -1));
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setHidden((current) => current + input);
      return;
    }
    // phase: list
    if (key.escape) {
      if (mode === 'wizard') {
        finishWizard('Setup skipped - you can add a key any time with /keys.', false);
      } else {
        session.closeKeys();
      }
      return;
    }
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((current) => Math.min(KEY_ROWS.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const row = KEY_ROWS[cursor];
      if (!row || row.id === 'ollama') {
        if (mode === 'wizard' && row?.id === 'ollama') {
          finishWizard('Ollama runs locally - no key needed.', false);
        }
        return;
      }
      setPhase({ kind: 'enter-key', provider: row.id, label: row.label });
      setNote('');
      setHidden('');
      return;
    }
    const answer = input.toLowerCase();
    if (answer === 'd') {
      const row = KEY_ROWS[cursor];
      if (!row) return;
      const hasStored = stored.includes(row.id) || (row.id === 'openrouter' && getKeySource() !== null);
      if (hasStored) {
        setPhase({ kind: 'confirm-remove', provider: row.id, label: row.label });
        setNote('');
      }
    }
  });

  const title =
    phase.kind === 'ask'
      ? 'Welcome - one quick setup question'
      : phase.kind === 'enter-key'
        ? `Paste the ${phase.label} key`
        : phase.kind === 'confirm-remove'
          ? `Remove the ${phase.label} key?`
          : phase.kind === 'saved'
            ? 'Saved'
            : mode === 'wizard'
              ? 'Which provider should provide your AI?'
              : 'Keys - stored in your Mac keychain';

  const hint =
    phase.kind === 'ask'
      ? 'y = yes · n = not now'
      : phase.kind === 'enter-key'
        ? 'paste the key · Enter save · Esc back'
        : phase.kind === 'confirm-remove'
          ? 'y = remove · n = keep · Esc back'
          : phase.kind === 'saved'
            ? 'press any key to continue'
            : mode === 'wizard'
              ? '↑↓ move · Enter choose · Esc back'
              : '↑↓ move · Enter add or replace · d remove · Esc close';

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{title}</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        {phase.kind === 'ask' && <Text>{'  Add an API key?'}</Text>}
        {phase.kind === 'list' &&
          KEY_ROWS.map((row, index) => (
            <Text key={row.id} inverse={index === cursor}>
              {`${row.label}`.padEnd(14)}
              <Text dimColor>{statusFor(row.id)}</Text>
            </Text>
          ))}
        {phase.kind === 'enter-key' && (
          <Text>
            <Text>Paste the {phase.label} key (it stays hidden): </Text>
            <Text inverse> </Text>
          </Text>
        )}
        {phase.kind === 'confirm-remove' && (
          <Text>
            Remove the {phase.label} key from your Mac keychain? <Text dimColor>({hint})</Text>
          </Text>
        )}
        {phase.kind === 'saved' && <Text>{phase.message}</Text>}
      </Box>
      {note ? (
        <Text color="yellow">{note}</Text>
      ) : (
        <Text dimColor>{hint}</Text>
      )}
    </Box>
  );
}