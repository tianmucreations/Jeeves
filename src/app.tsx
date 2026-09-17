import React, { useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session, useSession } from './state/session.js';
import { initKeys, hasCredentials, refreshCredit } from './providers/index.js';
import { getDailyLimit, getFavorites, getRecents, getRecentProjects, getDefaultModel, getDefaultProvider, getVerbosePreference } from './platform/config.js';
import { loadModels } from './models/registry.js';
import { ModelPicker } from './components/ModelPicker.js';
import { KeysManager } from './components/KeysManager.js';
import { HelpView } from './components/HelpView.js';
import { ProjectPicker } from './components/ProjectPicker.js';
import { AddressPrompt } from './components/AddressPrompt.js';

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
  const midHeight = Math.max(1, rows - 6);
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
      <Box height={1}>
        <Text dimColor>│ </Text>
        <Box width={inner - 2}>
          <Input scrollPage={midHeight} width={inner - 2} />
        </Box>
        <Text dimColor> │</Text>
      </Box>
      <Text dimColor>╰{separator}╯</Text>
      <Box height={1} flexDirection="column">
        <Footer />
      </Box>
    </Box>
  );
}