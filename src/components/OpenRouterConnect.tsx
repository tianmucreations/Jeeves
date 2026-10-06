import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import { ButtonRow, buttonAt, keyPress, type ButtonSpec } from './ButtonRow.js';
import { signInWithOpenRouter, WAITING_STEPS } from '../providers/openrouter-signin.js';
import { noCreditNote } from '../providers/openrouter.js';
import { storeOpenRouterKey, refreshCredit } from '../providers/index.js';
import { keyLooksValid } from '../commands/keys.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';
import { KEY_STORE, KEY_STORE_SUBJECT } from '../platform/wording.js';

// Connecting Jeeves to OpenRouter, said plainly (owner, 19 Sept: "virtually no
// information to even know what I was doing or what could happen"). As Claude Code's
// first run does: numbered choices, each explained in a line, then exactly what is
// happening while the browser is open - and the address, in case it didn't open.
// Used by /keys, the first-run setup and /model alike.

type Step = 'choose' | 'waiting' | 'paste';

const CHOICES = [
  { title: 'Sign in with OpenRouter (recommended)', detail: ['Your browser opens. Log in, or make a free account, then click Authorize', 'and come back. No key to copy.'] },
  { title: 'Paste a key I already have', detail: ['For people who already made a key at openrouter.ai/keys.', ''] },
];

export function OpenRouterConnect({ hasKey, onDone, onBack }: { hasKey: boolean; onDone: (message: string) => void; onBack: () => void }) {
  const { rows } = useWindowSize();
  const [step, setStep] = useState<Step>('choose');
  const [cursor, setCursor] = useState(0);
  const [pasted, setPasted] = useState('');
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const signingIn = useRef<AbortController | null>(null);

  useEffect(() => () => signingIn.current?.abort(), []);

  async function saveKey(key: string, how: 'signed-in' | 'pasted'): Promise<void> {
    if (!(await storeOpenRouterKey(key))) {
      setStep('choose');
      setNote(`${KEY_STORE_SUBJECT} was not reachable - please try again.`);
      return;
    }
    void refreshCredit();
    const credit = await noCreditNote(key);
    const saved =
      how === 'signed-in'
        ? `Connected - Jeeves is signed in to OpenRouter, and the key is saved securely in ${KEY_STORE}.`
        : `Your OpenRouter key is saved securely in ${KEY_STORE}. You will not be asked for it again.`;
    onDone(credit ? `${saved} ${credit}` : saved);
  }

  function signIn(): void {
    const controller = new AbortController();
    signingIn.current = controller;
    setStep('waiting');
    setNote('');
    setAddress('');
    void signInWithOpenRouter({ signal: controller.signal, onUrl: setAddress }).then((result) => {
      signingIn.current = null;
      if (result.ok) {
        void saveKey(result.key, 'signed-in');
        return;
      }
      setStep('choose');
      if (result.reason === 'cancelled') return;
      setNote(
        result.reason === 'timeout'
          ? 'No approval arrived after fifteen minutes, so I stopped waiting. Choose Sign in to try again.'
          : "OpenRouter didn't complete the sign-in. Choose Sign in to try again, or paste a key.",
      );
    });
  }

  // Each choice is four rows (name, two lines of detail, a blank), from row 4 - one more with the
  // "you already have a key" line.
  const press = (over: Parameters<typeof keyPress>[0]) => () => handleInput('', keyPress(over));
  const back: ButtonSpec = { label: '← Back', run: press({ escape: true }) };
  const footerButtons: ButtonSpec[] =
    step === 'waiting' ? [{ label: 'Cancel', run: press({ escape: true }) }] : step === 'paste' ? [back, { label: 'Save', run: press({ return: true }) }] : [back];
  const firstRow = 4 + (hasKey ? 1 : 0);
  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event || event.kind !== 'press' || event.button !== 0) return;
    // The buttons sit on the last row of the screen.
    if (event.row === rows) return void buttonAt(footerButtons, event.col)?.run();
    if (step !== 'choose') return;
    const index = Math.floor((event.row - firstRow) / 4);
    if (event.row >= firstRow && index >= 0 && index < CHOICES.length) {
      setNote('');
      if (index === 0) signIn();
      else setStep('paste');
    }
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  const handleInput = (input: string, key: Key) => {
    if (isMouseSequence(input)) return;
    if (step === 'waiting') {
      if (key.escape) signingIn.current?.abort();
      return;
    }
    if (step === 'paste') {
      if (key.escape) {
        setStep('choose');
        setPasted('');
        setNote('');
        return;
      }
      if (key.return) {
        const value = pasted.trim();
        if (!value) {
          setNote('Paste your key first - or press Esc to go back and choose Sign in instead.');
          return;
        }
        if (!keyLooksValid(value, 'openrouter')) {
          setPasted('');
          setNote('That does not look like an OpenRouter key (they start with sk-or-) - paste it again.');
          return;
        }
        void saveKey(value, 'pasted');
        return;
      }
      if (key.backspace || key.delete) {
        setPasted((current) => current.slice(0, -1));
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setNote('');
      setPasted((current) => current + input.replace(/[\r\n]/g, ''));
      return;
    }
    // step: choose
    if (key.escape) return onBack();
    if (key.upArrow || key.downArrow) {
      setCursor((current) => (current === 0 ? 1 : 0));
      return;
    }
    if (input === '1' || input === '2') {
      setCursor(Number(input) - 1);
    }
    if (key.return || input === '1' || input === '2') {
      const choice = input === '1' ? 0 : input === '2' ? 1 : cursor;
      setNote('');
      if (choice === 0) signIn();
      else setStep('paste');
    }
  };
  useInput(handleInput);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text dimColor>Connect Jeeves to OpenRouter</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent={step === 'choose' ? 'flex-start' : 'center'}>
        {step === 'choose' && (
          <>
            <Text wrap="truncate-end">OpenRouter runs the AI models Jeeves thinks with. One account, hundreds of models, pay only for use.</Text>
            {hasKey ? <Text color="yellow">You already have an OpenRouter key saved. A new one replaces it - same account, same credit.</Text> : null}
            <Text> </Text>
            {CHOICES.map((choice, index) => (
              <Box key={choice.title} flexDirection="column">
                <Text inverse={index === cursor}>{` ${index + 1}. ${choice.title} `}</Text>
                {choice.detail.map((line, i) => (
                  <Text key={i} dimColor wrap="truncate-end">{`    ${line}`}</Text>
                ))}
                <Text> </Text>
              </Box>
            ))}
          </>
        )}
        {step === 'waiting' && (
          <>
            {WAITING_STEPS.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            <Text> </Text>
            {address ? <Text dimColor>{`Browser didn't open? Go to: ${address}`}</Text> : null}
          </>
        )}
        {step === 'paste' && (
          <>
            <Text>
              <Text>Paste your OpenRouter key (it stays hidden): </Text>
              <Text dimColor>{pasted ? `${pasted.length} characters ` : ''}</Text>
              <Text inverse> </Text>
            </Text>
            <Text dimColor>Keys start with sk-or- and are made at openrouter.ai/keys.</Text>
          </>
        )}
      </Box>
      {note ? <Text color="yellow">{note}</Text> : null}
      <Text>
        <ButtonRow buttons={footerButtons} />
        <Text dimColor>{'  ' + (step === 'choose' ? 'click one, or ↑↓ Enter' : step === 'waiting' ? 'waiting for your browser' : 'paste the key')}</Text>
      </Text>
    </Box>
  );
}
