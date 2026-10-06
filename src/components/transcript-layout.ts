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
  // Jeeves's answer lines carry a gold bar in front (drawn apart from the text, so
  // it is never copied): the width in columns, 0 or absent for every other line.
  gutter?: number;
}

// The bar down the left of every answer line, in Tianmu gold: when scrolling back
// through a long conversation the answers stand out from the actions and notes
// between them (owner, 26 Sept: "I scroll for ages to find where his answer starts").
export const ANSWER_GUTTER = '▎ ';
export const ANSWER_GUTTER_COLOUR = '#c9a96a';

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
const TOOL_NAMES: Record<string, string> = { readFile: 'Read', listDir: 'List', searchFiles: 'Search', findFiles: 'Find', helper: 'Helper', writeFile: 'Write', editFile: 'Edit', runBash: '', webSearch: 'Search', readWebPage: 'Read', askExpert: 'Expert', noteResearch: 'Research' };

export function toolName(tool: string): string {
  return TOOL_NAMES[tool] ?? tool;
}

function phrase(tool: string, summary: string): string {
  return [toolName(tool), summary].filter((part) => part.length > 0).join(' ');
}

export function toolLineText(d: ToolLineData): { text: string; color?: 'yellow' | 'red'; dim?: boolean } {
  // A merged group carries its finished sentence whole (see mergeToolGroups).
  if (d.mergedText) {
    return { text: d.mergedText, color: d.state === 'failed' || d.state === 'declined' ? 'red' : undefined };
  }
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
// Formatting an answer (markdown, then wrapping) is the costly part of a redraw, and
// a redraw used to redo EVERY earlier answer each time a new word arrived: a long
// conversation made each word slower than the last. Finished text and width give the
// same lines every time, so they are kept (the newest few hundred).
const answerCache = new Map<string, { text: string; spans: StyleSpan[] }[]>();
function answerLines(text: string, width: number, keep: boolean): { text: string; spans: StyleSpan[] }[] {
  const key = `${width}\u0000${text}`;
  const hit = answerCache.get(key);
  if (hit) return hit;
  const styled = renderMarkdown(text);
  const wrapped = wrapStyled(styled.text, styled.spans, width);
  // The answer still being written changes with every word: never worth keeping.
  if (!keep) return wrapped;
  answerCache.set(key, wrapped);
  if (answerCache.size > 300) answerCache.delete(answerCache.keys().next().value as string);
  return wrapped;
}

// A finished look-around (read, list, search) is not kept on screen unless /verbose.
export function isQuietEntry(entry: TranscriptEntry, verbose: boolean): boolean {
  return !verbose && entry.kind === 'tool' && entry.data.state === 'done' && entry.data.quiet === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CLUTTER FIX (owner, 3 Oct: "collapse these into a single, clean, dynamic
// summary line"). Runs of the same finished action used to stack a line each —
// seven "✓ Changed 1 file" rows in one job. They are merged HERE, at the
// moment the group settles into the terminal's history: one line, with the
// count. The lines the person watches while the job runs stay as they are
// (they show progress); only what is printed into history condenses.
// ─────────────────────────────────────────────────────────────────────────────

// Which runs condense, and into what sentence.
function mergeKindOf(entry: TranscriptEntry): 'change' | 'run' | 'fail' | 'decline' | null {
  if (entry.kind !== 'tool') return null;
  const d = entry.data;
  if (d.mergedText) return null; // already merged
  if (d.state === 'done' && !d.quiet && (d.tool === 'writeFile' || d.tool === 'editFile')) return 'change';
  if (d.state === 'done' && !d.quiet && d.tool === 'runBash') return 'run';
  if (d.state === 'failed') return 'fail';
  if (d.state === 'declined') return 'decline';
  return null;
}

const countWord = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mergeToolGroups(entries: TranscriptEntry[], verbose = false): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    const kind = mergeKindOf(entry);
    if (kind === null) {
      out.push(entry);
      index += 1;
      continue;
    }
    // Gather the run: the same tool and kind, back to back. A quiet look-around
    // in between prints nothing (unless /verbose is on), so it does not break
    // the run - two changed files either side of a read still condense to one.
    let end = index + 1;
    while (end < entries.length) {
      const next = entries[end];
      if (isQuietEntry(next, verbose)) {
        end += 1;
        continue;
      }
      if (mergeKindOf(next) === kind && next.kind === 'tool' && entry.kind === 'tool' && next.data.tool === entry.data.tool) {
        end += 1;
        continue;
      }
      break;
    }
    const count = entries.slice(index, end).filter((member) => member.kind === 'tool' && mergeKindOf(member) === kind).length;
    if (count === 1) {
      out.push(entry);
      index = end;
      continue;
    }
    const tool = entry.kind === 'tool' ? entry.data.tool : '';
    const last = entries[end - 1];
    let mergedText: string;
    if (kind === 'change') mergedText = `✓ Changed ${countWord(count, 'file')}`;
    else if (kind === 'run') mergedText = `✓ Ran ${countWord(count, 'command')}`;
    else if (kind === 'fail') {
      const reason = last.kind === 'tool' ? last.data.label : '';
      mergedText = `✗ ${toolName(tool)} failed ${countWord(count, 'time')}${reason ? ` - ${clipLine(reason, 50)}` : ''}`;
    } else {
      mergedText = `✗ ${toolName(tool)} - you said no (${countWord(count, 'time')})`;
    }
    out.push({
      id: entry.kind === 'tool' ? entry.id : 0,
      kind: 'tool',
      data: { tool, summary: '', state: entry.kind === 'tool' ? entry.data.state : 'done', label: '', mergedText },
    });
    index = end;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE ENTRY AT A TIME, for the terminal's own history (3 Oct): finished text is
// printed to the scrollback the moment it settles, and never redrawn. This
// formats a single entry the same way buildDisplayLines would, so the
// conversation reads identically — it just keeps flowing upwards.
// ─────────────────────────────────────────────────────────────────────────────
export function entryDisplayLines(entry: TranscriptEntry, width: number, verbose = false): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const pushWrapped = (text: string, prefix: string, indent: string, color?: 'yellow' | 'red', dim?: boolean) => {
    for (const line of wrapWithPrefix(text, width, prefix, indent)) {
      lines.push({ text: line, color, dim });
    }
  };
  switch (entry.kind) {
    case 'user': {
      // The gap that separates your words from what came before, then the grey band.
      lines.push({ text: ' ' });
      for (const line of wrapWithPrefix(entry.text, width, '> ', '  ')) {
        lines.push({ text: line + ' '.repeat(Math.max(0, width - stringWidth(line))), own: true });
      }
      break;
    }
    case 'assistant': {
      // Always a gap above Jeeves's answer, so it never runs straight on from
      // the actions above it (the owner's request, 18 Sept).
      lines.push({ text: ' ' });
      for (const line of answerLines(entry.text, width - ANSWER_GUTTER.length, true)) {
        lines.push({ text: line.text, spans: line.spans.length ? line.spans : undefined, gutter: ANSWER_GUTTER.length });
      }
      break;
    }
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
      if (entry.data.state === 'awaiting' && entry.data.detail) {
        for (const line of entry.data.detail.split('\n')) {
          lines.push({ text: clipLine('  ' + line, width), dim: true });
        }
      }
      const rendered = toolLineText(entry.data);
      lines.push({ text: clipLine(rendered.text, width), color: rendered.color, dim: rendered.dim });
      break;
    }
  }
  return lines;
}

export function buildDisplayLines(entries: TranscriptEntry[], width: number, verbose = false): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const pushWrapped = (text: string, prefix: string, indent: string, color?: 'yellow' | 'red', dim?: boolean) => {
    for (const line of wrapWithPrefix(text, width, prefix, indent)) {
      lines.push({ text: line, color, dim });
    }
  };
  for (const entry of entries) {
    if (isQuietEntry(entry, verbose)) continue;
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
          for (const line of answerLines(entry.text, width - ANSWER_GUTTER.length, entry !== entries[entries.length - 1])) {
            lines.push({ text: line.text, spans: line.spans.length ? line.spans : undefined, gutter: ANSWER_GUTTER.length });
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
        // The change itself sits above the question, dim, so the person approves
        // with open eyes (Claude Code's diff-in-the-prompt). The lines are
        // already short and marked - old / + new; they only ever show while
        // the question waits.
        if (entry.data.state === 'awaiting' && entry.data.detail) {
          for (const line of entry.data.detail.split('\n')) {
            lines.push({ text: clipLine('  ' + line, width), dim: true });
          }
        }
        const rendered = toolLineText(entry.data);
        lines.push({ text: clipLine(rendered.text, width), color: rendered.color, dim: rendered.dim });
        break;
      }
    }
  }
  return lines;
}