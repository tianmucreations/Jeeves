import React, { useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input, inputRowsFor } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session, useSession } from './state/session.js';
import { initKeys, hasCredentials, refreshCredit, serviceKey } from './providers/index.js';
import { isDirectService, type DirectServiceId } from './providers/direct-services.js';
import { loadDirectModels } from './providers/catalogue.js';
import { getDailyLimit, getFavorites, getRecents, getRecentProjects, getDefaultModel, getDefaultProvider, getVerbosePreference } from './platform/config.js';
import { loadModels } from './models/registry.js';
import { ModelPicker } from './components/ModelPicker.js';
import { KeysManager } from './components/KeysManager.js';
import { HelpView } from './components/HelpView.js';
import { ProjectPicker } from './components/ProjectPicker.js';
import { AddressPrompt } from './components/AddressPrompt.js';
import { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING } from './ink/mouse.js';
import { pressCtrlCToQuit } from './ink/quit.js';

// The main window: a rounded box border around the top section only, with the
// info bar on its own row below the box. Top to bottom: plain top border, header
// row inside the box (Jeeves left, dot right), transcript (flexGrow), internal
// separator, input row, plain bottom border closing the box, then the info bar
// outside the box at the very bottom (model left, metrics right). Budget:
// border 1 + header 1 + transcript rows-6 + separator 1 + input 1 + border 1 +
// info bar 1 = exactly the terminal's rows.
export function App() {
  const s = useSession();
  const { stdout } = useStdout();
  const rows = Math.max(stdout.rows ?? 24, 8);
  const columns = Math.max(stdout.columns ?? 80, 40);
  const inner = columns - 2;
  // The input box grows with the message (up to MAX_INPUT_ROWS); the transcript gives
  // up the rows. A hint or question in the input row is always one row.
  const inputRows = s.approvalPending || s.transcriptScrollUp > 0 ? 1 : inputRowsFor(s.inputText, inner - 2);
  const midHeight = Math.max(1, rows - 5 - inputRows);
  const inputSideLeft = Array.from({ length: inputRows }, () => '│ ').join('\n');
  const inputSideRight = Array.from({ length: inputRows }, () => ' │').join('\n');
  const side = '│\n'.repeat(midHeight - 1) + '│';
  const separator = '─'.repeat(inner);

  useEffect(() => {
    session.setFavorites(getFavorites());
    session.setDailyLimit(getDailyLimit());
    session.setRecents(getRecents());
    session.setRecentProjects(getRecentProjects());
    if (getVerbosePreference()) session.setVerbose(true);
    const defaultModel = getDefaultModel();
    if (defaultModel) session.setModel(defaultModel);
    const defaultProvider = getDefaultProvider();
    if (defaultProvider) session.setProvider(defaultProvider);
    void loadModels().then(({ models, error }) => session.setModels(models, error));
    // Keys resolve from the Mac keychain first; the first-run wizard now starts
    // after the project is chosen (the project list always shows first).
    void initKeys().then(() => {
      // A direct connection's models (memory sizes, prices) load in the background.
      const directKey = isDirectService(session.providerId) ? serviceKey(session.providerId) : null;
      if (directKey) void loadDirectModels(session.providerId as DirectServiceId, directKey).catch(() => {});
      if (hasCredentials()) {
        void refreshCredit();
      } else {
        session.setStatus('disconnected');
      }
    });
  }, []);

  // The mouse is Jeeves's only on the conversation screen (wheel scrolling, drag to
  // copy). On every other screen - keys, models, help, folders, the first question -
  // it goes back to the terminal, so its own selecting and Cmd+C copy work: a web
  // address such as where to get a key can be copied (owner, 19 Sept: "I still
  // can't copy things").
  const onConversation = !(s.wizardActive || s.keysOpen || s.pickerOpen || s.helpOpen || s.addressOpen || s.launchStage !== 'ready');
  // On the setup screens Ctrl+C is only for quitting - still twice, never at once.
  // (The conversation screen's typing box handles its own.)
  useInput((input, key) => {
    if (key.ctrl && input === 'c' && !onConversation) pressCtrlCToQuit();
  });

  useEffect(() => {
    try {
      process.stdout.write(onConversation ? ENABLE_MOUSE_TRACKING : DISABLE_MOUSE_TRACKING);
    } catch {
      // A closed stream must never crash the app.
    }
  }, [onConversation]);

  if (s.wizardActive) {
    return <KeysManager mode="wizard" rows={rows} columns={columns} />;
  }
  if (s.keysOpen) {
    return <KeysManager mode="manage" rows={rows} columns={columns} />;
  }
  if (s.pickerOpen) {
    return <ModelPicker rows={rows} columns={columns} />;
  }
  if (s.helpOpen) {
    return <HelpView rows={rows} />;
  }
  if (s.addressOpen || s.launchStage === 'address') {
    return <AddressPrompt rows={rows} />;
  }
  if (s.launchStage === 'project') {
    return <ProjectPicker rows={rows} columns={columns} />;
  }

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Text dimColor>╭{separator}╮</Text>
      <Box height={1}>
        <Text dimColor>│</Text>
        <Box width={inner} paddingLeft={1} paddingRight={1} flexDirection="column">
          <Header />
        </Box>
        <Text dimColor>│</Text>
      </Box>
      <Box height={midHeight}>
        <Box width={1} flexShrink={0}>
          <Text dimColor>{side}</Text>
        </Box>
        <Box width={inner} paddingLeft={1} paddingRight={1}>
          <Transcript width={inner - 2} />
        </Box>
        <Box width={1} flexShrink={0}>
          <Text dimColor>{side}</Text>
        </Box>
      </Box>
      <Text dimColor>├{separator}┤</Text>
      <Box height={inputRows}>
        <Text dimColor>{inputSideLeft}</Text>
        <Box width={inner - 2}>
          <Input scrollPage={midHeight} width={inner - 2} />
        </Box>
        <Text dimColor>{inputSideRight}</Text>
      </Box>
      <Text dimColor>╰{separator}╯</Text>
      <Box height={1} flexDirection="column">
        <Footer />
      </Box>
    </Box>
  );
}