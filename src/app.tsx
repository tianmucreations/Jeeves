import React, { useEffect } from 'react';
import { Box } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Input } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session } from './state/session.js';
import { hasCredentials } from './providers/index.js';

export function App() {
  useEffect(() => {
    if (!hasCredentials()) {
      session.setStatus('disconnected');
      session.addNotice('No OpenRouter API key set. Start with: OPENROUTER_API_KEY=your-key npm run dev');
    }
  }, []);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} minHeight={12}>
      <Header />
      <Box flexGrow={1}>
        <Transcript />
      </Box>
      {/* Assumption: Section 2.4 puts the footer at the true bottom of the window, so the input line sits just above it. */}
      <Input />
      <Footer />
    </Box>
  );
}