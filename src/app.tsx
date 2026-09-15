import React, { useEffect } from 'react';
import { Box, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session } from './state/session.js';
import { hasCredentials } from './providers/index.js';

// The whole frame is exactly the height of the terminal window, so nothing ever
// scrolls away: the header is pinned at the top, the footer and input at the bottom,
// and only the fixed-height transcript area in the middle re-clips its content.
export function App() {
  const { stdout } = useStdout();
  const rows = Math.max(stdout.rows ?? 24, 8);
  const columns = Math.max(stdout.columns ?? 80, 40);
  const transcriptHeight = Math.max(1, rows - 5);
  const innerWidth = columns - 4;

  useEffect(() => {
    if (!hasCredentials()) {
      session.setStatus('disconnected');
      session.addNotice('No OpenRouter API key found. Add OPENROUTER_API_KEY=your-key to the .env file in the project folder.');
    }
  }, []);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} height={rows}>
      <Header />
      <Transcript height={transcriptHeight} width={innerWidth} />
      <Footer />
      <Input />
    </Box>
  );
}