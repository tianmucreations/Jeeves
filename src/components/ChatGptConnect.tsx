import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from '../vendor/ink/index.js';
import { signInWithChatGpt, CHATGPT_WAITING_STEPS } from '../providers/chatgpt.js';
import { storeChatGptTokens } from '../providers/index.js';
import { ButtonRow, buttonAt } from './ButtonRow.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';
import { KEY_STORE, KEY_STORE_SUBJECT } from '../platform/wording.js';

// Signing in with a ChatGPT plan: one click, the browser opens, approve, come back. Nothing to
// copy. Used by Manage keys, the first-run setup and the model list alike.
type Step = 'choose' | 'waiting';

export function ChatGptConnect({ onDone, onBack }: { onDone: (message: string) => void; onBack: () => void }) {
  const [step, setStep] = useState<Step>('choose');
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const signingIn = useRef<AbortController | null>(null);

  useEffect(() => () => signingIn.current?.abort(), []);

  function signIn(): void {
    const controller = new AbortController();
    signingIn.current = controller;
    setStep('waiting');
    setNote('');
    setAddress('');
    void signInWithChatGpt({ signal: controller.signal, onUrl: setAddress }).then(async (result) => {
      signingIn.current = null;
      if (result.ok) {
        if (!(await storeChatGptTokens(result.tokens))) {
          setStep('choose');
          setNote(`${KEY_STORE_SUBJECT} was not reachable - please try again.`);
          return;
        }
        onDone(`Connected - Jeeves will use your ChatGPT plan. The sign-in is saved securely in ${KEY_STORE}.`);
        return;
      }
      setStep('choose');
      if (result.reason === 'cancelled') return;
      setNote(
        result.reason === 'timeout'
          ? 'No approval arrived after five minutes, so I stopped waiting. Press Enter to try again.'
          : result.reason === 'busy'
            ? 'Another program (such as the ChatGPT Codex app) is using the sign-in door. Close it and press Enter to try again.'
            : "ChatGPT didn't complete the sign-in. Press Enter to try again."
      );
    });
  }

  const cancel = { label: 'Cancel', run: () => signingIn.current?.abort() };
  const chooseButtons = [
    { label: '← Back', run: onBack },
    {
      label: 'Sign in with ChatGPT',
      run: () => {
        setNote('');
        signIn();
      },
    },
  ];
  // The Sign in button is on row 6 of the first screen (title, blank, two lines, blank, button).
  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event || event.kind !== 'press' || event.button !== 0) return;
    // Waiting: Cancel is on row 2. Choosing: Sign in and Back share row 6.
    if (step === 'waiting') return void (event.row === 2 && buttonAt([cancel], event.col)?.run());
    if (event.row === 6) buttonAt(chooseButtons, event.col)?.run();
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (step === 'waiting') {
      if (key.escape) signingIn.current?.abort();
      return;
    }
    if (key.escape) return onBack();
    if (key.return || input === '1') {
      setNote('');
      signIn();
    }
  });

  if (step === 'waiting') {
    return (
      <Box flexDirection="column">
        <Text>Signing in with ChatGPT</Text>
        <ButtonRow buttons={[cancel]} />
        {CHATGPT_WAITING_STEPS.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        {address ? (
          <>
            <Text> </Text>
            <Text dimColor>Browser didn't open? Go to:</Text>
            <Text dimColor wrap="wrap">{address}</Text>
          </>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>Connect Jeeves to your ChatGPT plan</Text>
      <Text> </Text>
      <Text dimColor wrap="truncate-end">Use the ChatGPT Plus or Pro plan you already pay for - no key to copy, no extra bill.</Text>
      <Text dimColor wrap="truncate-end">Your browser opens; log in and click to allow Jeeves, then come back.</Text>
      <Text> </Text>
      <ButtonRow buttons={chooseButtons} />
      {note ? <Text color="yellow">{note}</Text> : null}
      <Text> </Text>
      <Text dimColor>click a button, or press Enter</Text>
    </Box>
  );
}
