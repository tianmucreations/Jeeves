import React, { useEffect } from 'react';
import { Box, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session, useSession } from './state/session.js';
import { initKeys, hasCredentials, refreshCredit } from './providers/index.js';
import { getHiddenMetrics, getFavorites, getRecents, getDefaultModel, getDefaultProvider, getVerbosePreference } from './platform/config.js';
import { loadModels } from './models/registry.js';
import { ModelPicker } from './components/ModelPicker.js';
import { KeysManager } from './components/KeysManager.js';
import { HelpView } from './components/HelpView.js';

// The whole frame is exactly the height of the terminal window, so nothing ever
// scrolls away: the header is pinned at the top, the footer and input at the bottom,
// and only the fixed-height transcript area in the middle re-clips its content.
export function App() {
  const s = useSession();
  const { stdout } = useStdout();
  const rows = Math.max(stdout.rows ?? 24, 8);
  const columns = Math.max(stdout.columns ?? 80, 40);
  const transcriptHeight = Math.max(1, rows - 5);
  const innerWidth = columns - 4;

  useEffect(() => {
    session.setHiddenMetrics(getHiddenMetrics());
    session.setFavorites(getFavorites());
    session.setRecents(getRecents());
    if (getVerbosePreference()) session.setVerbose(true);
    const defaultModel = getDefaultModel();
    if (defaultModel) session.setModel(defaultModel);
    const defaultProvider = getDefaultProvider();
    if (defaultProvider) session.setProvider(defaultProvider);
    void loadModels().then(({ models, error }) => session.setModels(models, error));
    // Keys resolve from the Mac keychain first, with the .env file as a development
    // fallback that gets migrated into the keychain on first launch.
    void initKeys().then(() => {
      if (hasCredentials()) {
        void refreshCredit();
      } else {
        session.setStatus('disconnected');
        session.startWizard();
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

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} height={rows}>
      <Header />
      <Transcript height={transcriptHeight} width={innerWidth} />
      <Footer />
      <Input />
    </Box>
  );
}