import stringWidth from 'string-width';
import type { TranscriptEntry, ToolLineData } from '../state/session.js';
import { renderMarkdown, type StyleSpan } from './markdown.js';

export interface DisplayLine {
  text: string;
  color?: 'yellow' | 'red';
  dim?: boolean;
  // The person's own words: drawn on a soft grey band across the full width.
  own?: boolean;
  // Bold, italic or code parts of the line (Jeeves's answers), by character.
  spans?: StyleSpan[];
}

// Wraps formatted text at word boundaries, carrying each style range onto the
// lines it lands on. Every line break in the text starts a new line.
export function wrapStyled(text: string, spans: StyleSpan[], width: number): { text: string; spans: StyleSpan[] }[] {
  const out: { text: string; spans: StyleSpan[] }[] = [];
  let offset = 0;
  for (const paragraph of text.split('\n')) {
    // A list line's wrapped lines start under its words, not under the "- ".
    const hang = /^(\s*(?:[-•]|\d+\.)\s)/.exec(paragraph)?.[1].length ?? 0;
    const pieces: [number, number][] = [];
    let start = 0;
    do {
      const max = Math.max(1, width - (start > 0 ? hang : 0));
      if (paragraph.length - start <= max) {
        pieces.push([start, paragraph.length]);
        break;
      }
      let cut = paragraph.lastIndexOf(' ', start + max);
      if (cut <= start) cut = start + max;
      pieces.push([start, cut]);
      start = paragraph[cut] === ' ' ? cut + 1 : cut;
    } while (start < paragraph.length);
    pieces.forEach(([from, to], index) => {
      const line = paragraph.slice(from, to).replace(/\s+$/, '');
      const absFrom = offset + from;
      const absTo = absFrom + line.length;
      const pad = index > 0 ? hang : 0;
      const lineSpans = spans
        .filter((span) => span.to > absFrom && span.from < absTo)
        .map((span) => ({ ...span, from: Math.max(span.from, absFrom) - absFrom + pad, to: Math.min(span.to, absTo) - absFrom + pad }));
      // A single space: an empty line would be drawn with no height at all.
      out.push({ text: ' '.repeat(pad) + line || ' ', spans: lineSpans });
    });
    offset += paragraph.length + 1;
  }
  return out;
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
// runBash's summaries are full plain phrases of their own ("Create folder X"),
// so they carry no tool name - the phrase IS the question.
const TOOL_NAMES: Record<string, string> = { readFile: 'Read', listDir: 'List', writeFile: 'Write', runBash: '', webSearch: 'Search', readWebPage: 'Read', askExpert: 'Expert', noteResearch: 'Research' };

export function toolName(tool: string): string {
  return TOOL_NAMES[tool] ?? tool;
}

function phrase(tool: string, summary: string): string {
  return [toolName(tool), summary].filter((part) => part.length > 0).join(' ');
}

export function toolLineText(d: ToolLineData): { text: string; color?: 'yellow' | 'red'; dim?: boolean } {
  if (d.state === 'awaiting') {
    return { text: `? ${phrase(d.tool, d.summary)} — allow?`, color: 'yellow' };
  }
  if (d.state === 'running') {
    return { text: `… ${phrase(d.tool, d.summary)}`, dim: true };
  }
  if (d.state === 'declined') {
    return { text: `✗ ${phrase(d.tool, clipLine(d.summary, 50))} - you said no`, color: 'red' };
  }
  // Held until research is done: not a failure and not a refusal, so neither red nor alarming.
  if (d.state === 'held') {
    return { text: `· ${phrase(d.tool, clipLine(d.summary, 50))} - ${d.label}`, dim: true };
  }
  if (d.state === 'failed') {
    return { text: `✗ ${phrase(d.tool, d.summary)} failed: ${clipLine(d.label, 60)}`, color: 'red' };
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
        {
          // Markdown drawn as formatting, never as stray ** and ## marks.
          const styled = renderMarkdown(entry.text);
          for (const line of wrapStyled(styled.text, styled.spans, width)) {
            lines.push({ text: line.text, spans: line.spans.length ? line.spans : undefined });
          }
        }
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