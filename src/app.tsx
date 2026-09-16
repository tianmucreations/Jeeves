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

// The whole frame is exactly the height of the terminal window, so nothing ever
// scrolls away: the header is pinned at the top, the footer and input at the bottom,
// and only the fixed-height transcript area in the middle re-clips its content.
export function App() {
  const s = useSession();
  const { stdout } = useStdout();
  const rows = Math.max(stdout.rows ?? 24, 8);
  const columns = Math.max(stdout.columns ?? 80, 40);
  const transcriptHeight = Math.max(1, rows - 7);
  const innerWidth = columns - 4;
  const separator = '─'.repeat(innerWidth);

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

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} height={rows}>
      <Header />
      <Transcript height={transcriptHeight} width={innerWidth} />
      <Text dimColor>{separator}</Text>
      <Input scrollPage={transcriptHeight} />
      <Text dimColor>{separator}</Text>
      <Footer />
    </Box>
  );
}