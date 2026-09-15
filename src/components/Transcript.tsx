import React from 'react';
import { Box, Text } from 'ink';
import { useSession } from '../state/session.js';

function ToolLineView({ entry }: { entry: Extract<import('../state/session.js').TranscriptEntry, { kind: 'tool' }> }) {
  const d = entry.data;
  if (d.state === 'awaiting') {
    return (
      <Text color="yellow">
        ? {d.tool} {d.summary} — allow? (y/n)
      </Text>
    );
  }
  if (d.state === 'running') {
    return (
      <Text dimColor>
        … {d.tool} {d.summary}
      </Text>
    );
  }
  if (d.state === 'declined') {
    return (
      <Text color="red">✗ {d.tool} declined</Text>
    );
  }
  if (d.state === 'failed') {
    return (
      <Text color="red">✗ {d.tool} failed: {clipForLine(d.label)}</Text>
    );
  }
  return <Text>✓ {d.label}</Text>;
}

function clipForLine(text: string): string {
  return text.length > 80 ? text.slice(0, 79) + '…' : text;
}

export function Transcript() {
  const s = useSession();
  return (
    <Box flexDirection="column">
      {s.transcript.map((entry) => {
        if (entry.kind === 'tool') return <ToolLineView key={entry.id} entry={entry} />;
        if (entry.kind === 'user') {
          return (
            <Text key={entry.id}>
              <Text dimColor>{'> '}</Text>
              {entry.text}
            </Text>
          );
        }
        if (entry.kind === 'error') {
          return (
            <Text key={entry.id} color="red">
              {entry.text}
            </Text>
          );
        }
        if (entry.kind === 'notice') {
          return (
            <Text key={entry.id} color="yellow">
              {entry.text}
            </Text>
          );
        }
        return <Text key={entry.id}>{entry.text}</Text>;
      })}
      {s.transcript.length === 0 && <Text dimColor> </Text>}
    </Box>
  );
}