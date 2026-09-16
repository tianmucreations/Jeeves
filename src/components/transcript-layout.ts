import type { TranscriptEntry, ToolLineData } from '../state/session.js';

export interface DisplayLine {
  text: string;
  color?: 'yellow' | 'red';
  dim?: boolean;
}

// Greedy word-wrap for plain text. Long unbreakable words are hard-broken at the width.
export function wrapParagraph(s: string, max: number): string[] {
  if (max <= 0) return [s];
  if (s.length <= max) return [s];
  const lines: string[] = [];
  let start = 0;
  while (start < s.length) {
    if (s.length - start <= max) {
      lines.push(s.slice(start).trimEnd());
      break;
    }
    let cut = s.lastIndexOf(' ', start + max);
    if (cut <= start) cut = start + max;
    lines.push(s.slice(start, cut).trimEnd());
    start = s[cut] === ' ' ? cut + 1 : cut;
  }
  return lines;
}

// Clip to a single physical line - used for tool actions so they can never wrap.
export function clipLine(s: string, width: number): string {
  if (width <= 1) return s.slice(0, width);
  return s.length <= width ? s : s.slice(0, width - 1) + '…';
}

// Wraps an entry's text across multiple physical lines; the first line gets the
// prefix, continuation lines get the indent. Prefix and indent must be the same width.
function wrapWithPrefix(s: string, width: number, prefix: string, indent: string): string[] {
  const max = width - prefix.length;
  const paragraphs = s.split('\n');
  const raw: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) raw.push('');
    if (paragraphs[i]) raw.push(...wrapParagraph(paragraphs[i], max));
  }
  return raw.map((line, index) => (index === 0 ? prefix + line : indent + line));
}

function toolLineText(d: ToolLineData): { text: string; color?: 'yellow' | 'red'; dim?: boolean } {
  if (d.state === 'awaiting') {
    return { text: `? ${d.tool} ${d.summary} — allow? (y/n)`, color: 'yellow' };
  }
  if (d.state === 'running') {
    return { text: `… ${d.tool} ${d.summary}`, dim: true };
  }
  if (d.state === 'declined') {
    return { text: `✗ ${d.tool} declined`, color: 'red' };
  }
  if (d.state === 'failed') {
    return { text: `✗ ${d.tool} failed: ${clipLine(d.label, 60)}`, color: 'red' };
  }
  return { text: `✓ ${d.label}` };
}

// Picks the visible window of display lines for the transcript region. The
// terminal's own scrollback is off in alternate-screen mode, so this is the
// app's whole scrolling story: scrollUp counts lines above the bottom edge,
// and 0 pins the view to the newest line (follow mode).
export function visibleWindow<T extends { text: string }>(
  lines: T[],
  height: number,
  scrollUp: number
): { visible: T[]; linesAbove: number; linesBelow: number } {
  const total = lines.length;
  const maxScroll = Math.max(0, total - height);
  const offset = Math.min(Math.max(0, scrollUp), maxScroll);
  const end = total - offset;
  const start = Math.max(0, end - height);
  const visible = lines.slice(start, end);
  return { visible, linesAbove: start, linesBelow: total - end };
}

// Turns transcript entries into physical display lines that fit the given width.
export function buildDisplayLines(entries: TranscriptEntry[], width: number): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const pushWrapped = (text: string, prefix: string, indent: string, color?: 'yellow' | 'red', dim?: boolean) => {
    for (const line of wrapWithPrefix(text, width, prefix, indent)) {
      lines.push({ text: line, color, dim });
    }
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case 'user':
        pushWrapped(entry.text, '> ', '  ');
        break;
      case 'assistant':
        pushWrapped(entry.text, '', '');
        break;
      case 'reasoning':
        pushWrapped(entry.text, '· ', '  ', undefined, true);
        break;
      case 'error':
        pushWrapped(entry.text, '', '', 'red');
        break;
      case 'notice':
        pushWrapped(entry.text, '', '', 'yellow');
        break;
      case 'tool': {
        const rendered = toolLineText(entry.data);
        lines.push({ text: clipLine(rendered.text, width), color: rendered.color, dim: rendered.dim });
        break;
      }
    }
  }
  return lines;
}