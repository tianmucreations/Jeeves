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

// The main window is Claude Code's slot layout inside the AlternateScreen ceiling:
// fixed header, transcript flexGrow (fills all remaining rows - no dead space),
// fixed input, fixed info bar. Only the transcript region scrolls, and it scrolls
// itself via the ScrollBox pattern; the terminal has no scrollback here.
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

  // The slot layout, per Claude Code's REPL: the ceiling comes from AlternateScreen's
  // <Box height={rows}>; inside it, the header is fixed, the transcript's flexGrow
  // region fills every row that is left, and the input (with its separator) and the
  // info bar are fixed at the bottom. No border, no padding: full width.
  return (
    <Box flexDirection="column" height={rows}>
      <Box height={1}>
        <Header />
      </Box>
      <Transcript width={columns} />
      <Box height={2} flexDirection="column">
        <Text dimColor>{separator}</Text>
        <Input scrollPage={Math.max(1, rows - 4)} />
      </Box>
      <Box height={1}>
        <Footer />
      </Box>
    </Box>
  );
}