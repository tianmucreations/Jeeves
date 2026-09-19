import stringWidth from 'string-width';
import type { TranscriptEntry, ToolLineData } from '../state/session.js';

export interface DisplayLine {
  text: string;
  color?: 'yellow' | 'red';
  dim?: boolean;
  // The person's own words: drawn on a soft grey band across the full width.
  own?: boolean;
}

// Claude Code marks the person's messages the same way: a blank line above and a
// grey band behind (its dark theme's userMessageBackground, rgb(55, 55, 55)), with
// white text so the band reads on light and dark terminals alike.
export const OWN_MESSAGE_BACKGROUND = '#373737';
export const OWN_MESSAGE_TEXT = '#ffffff';

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

// The tools' everyday names on screen; the internal names are for the model only.
const TOOL_NAMES: Record<string, string> = { readFile: 'Read', listDir: 'List', writeFile: 'Write', runBash: 'Run', webSearch: 'Search', readWebPage: 'Read', askExpert: 'Expert', noteResearch: 'Research' };

export function toolName(tool: string): string {
  return TOOL_NAMES[tool] ?? tool;
}

export function toolLineText(d: ToolLineData): { text: string; color?: 'yellow' | 'red'; dim?: boolean } {
  if (d.state === 'awaiting') {
    return { text: `? ${toolName(d.tool)} ${d.summary} — allow? (y/n)`, color: 'yellow' };
  }
  if (d.state === 'running') {
    return { text: `… ${toolName(d.tool)} ${d.summary}`, dim: true };
  }
  if (d.state === 'declined') {
    return { text: `✗ ${toolName(d.tool)} ${clipLine(d.summary, 50)} - you said no`, color: 'red' };
  }
  // Held until research is done: not a failure and not a refusal, so neither red nor alarming.
  if (d.state === 'held') {
    return { text: `· ${toolName(d.tool)} ${clipLine(d.summary, 50)} - ${d.label}`, dim: true };
  }
  if (d.state === 'failed') {
    return { text: `✗ ${toolName(d.tool)} failed: ${clipLine(d.label, 60)}`, color: 'red' };
  }
  return { text: `✓ ${d.label}` };
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
      case 'user': {
        // A single space: an empty line would be drawn with no height at all.
        if (lines.length > 0) lines.push({ text: ' ' });
        for (const line of wrapWithPrefix(entry.text, width, '> ', '  ')) {
          lines.push({ text: line + ' '.repeat(Math.max(0, width - stringWidth(line))), own: true });
        }
        break;
      }
      case 'assistant':
        // Always a gap above Jeeves's answer, so it never runs straight on from the
        // actions above it (the owner's request, 18 Sept) or from your message.
        if (lines.length > 0 && lines[lines.length - 1].text.trim() !== '') lines.push({ text: ' ' });
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