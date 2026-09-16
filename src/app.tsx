import React, { useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session, useSession } from './state/session.js';
import { initKeys, hasCredentials, refreshCredit } from './providers/index.js';
import { getHiddenMetrics, getFavorites, getRecents, getRecentProjects, getDefaultModel, getDefaultProvider, getVerbosePreference } from './platform/config.js';
import { loadModels } from './models/registry.js';
import { ModelPicker } from './components/ModelPicker.js';
import { KeysManager } from './components/KeysManager.js';
import { HelpView } from './components/HelpView.js';
import { ProjectPicker } from './components/ProjectPicker.js';

// The main window is the slot layout inside the AlternateScreen ceiling: fixed
// header, transcript flexGrow (fills all remaining rows - no dead space), then the
// bottom stack - separator, input, separator, info bar - one element per row. Only
// the transcript region scrolls (ScrollBox pattern); the terminal has no
// scrollback here.
export function App() {
  const s = useSession();
  const { stdout } = useStdout();
  const rows = Math.max(stdout.rows ?? 24, 8);
  const columns = Math.max(stdout.columns ?? 80, 40);
  const separator = '─'.repeat(columns);

  useEffect(() => {
    session.setHiddenMetrics(getHiddenMetrics());
    session.setFavorites(getFavorites());
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
      if (hasCredentials()) {
        void refreshCredit();
      } else {
        session.setStatus('disconnected');
      }
    });
  }, []);

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
  if (s.launchStage === 'project') {
    return <ProjectPicker rows={rows} columns={columns} />;
  }

  // The slot layout, per the interface spec (Section 2): header 1 row, transcript
  // flexGrow (every row that is left), separator 1, input 1, separator 1, info bar
  // 1 - exactly the terminal's rows, each element in its own row. Every fixed slot
  // is height={1} with flexDirection="column": Ink's Box defaults to
  // flexDirection="row", and a row-direction wrapper shrink-wraps its child to the
  // child's own width, which pulled the traffic light off the far right of the
  // header (space-between only spreads across the full width). The column wrapper
  // stretches the child so the header and info bar really span the window.
  return (
    <Box flexDirection="column" height={rows}>
      <Box height={1} flexDirection="column">
        <Header />
      </Box>
      <Transcript width={columns} />
      <Box height={1} flexDirection="column">
        <Text dimColor>{separator}</Text>
      </Box>
      <Box height={1} flexDirection="column">
        <Input scrollPage={Math.max(1, rows - 5)} />
      </Box>
      <Box height={1} flexDirection="column">
        <Text dimColor>{separator}</Text>
      </Box>
      <Box height={1} flexDirection="column">
        <Footer />
      </Box>
    </Box>
  );
}