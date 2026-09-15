import React from 'react';
import { Box } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { Footer } from './components/Footer.js';

export function App() {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} minHeight={10}>
      <Header />
      <Box flexGrow={1}>
        <Transcript />
      </Box>
      <Footer />
    </Box>
  );
}