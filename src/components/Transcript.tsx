import React, { useMemo, useRef } from 'react';
import { Static, Text } from '../vendor/ink/index.js';
import { session, useSession, type TranscriptEntry } from '../state/session.js';
import {
  ANSWER_GUTTER,
  ANSWER_GUTTER_COLOUR,
  OWN_MESSAGE_BACKGROUND,
  OWN_MESSAGE_TEXT,
  buildDisplayLines,
  entryDisplayLines,
  isQuietEntry,
  mergeToolGroups,
  type DisplayLine,
} from './transcript-layout.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE CONVERSATION, THE CLAUDE CODE WAY (owner's order, 3 Oct: "finished text
// feeds directly into the terminal's own native scrollback... scroll up and
// down using the standard terminal scrolling action at any time, even while an
// answer is printing").
//
// Until today Jeeves owned the whole window and scrolled internally, which
// failed three times. Now the conversation is split the way Claude Code splits
// it (Messages.tsx: "Content dropped from this slice has already been printed
// to terminal scrollback - users can scroll up natively"):
//
//   • THE FEED — everything FINISHED, printed once into the terminal's own
//     history via <Static>, never redrawn. The terminal's scrollbar, trackpad
//     and Cmd+C selection reach it at all times.
//   • THE LIVE TAIL — only what is still moving: the answer being written,
//     the action in progress, the question waiting. A few rows above the
//     typing box, redrawn every frame.
//
// An entry joins the feed the moment it settles. The feed never reprints (a
// Static item is written exactly once), so the commit point must be stable:
// it is the longest prefix of settled entries that does not split a mergeable
// run (the condensing of repeated "Changed 1 file" lines happens at this
// boundary — see mergeToolGroups).
// ─────────────────────────────────────────────────────────────────────────────

// A tool line whose run may still grow (the same action following it) must
// stay in the live tail until its run settles, so the merged line can be
// printed once, whole.
function settlesAlone(entries: TranscriptEntry[], index: number): boolean {
  const entry = entries[index];
  const next = entries[index + 1];
  if (entry.kind !== 'tool' || next === undefined || next.kind !== 'tool') return true;
  const family = (data: { state: string; tool: string; quiet?: boolean }) => {
    if (data.state === 'done' && !data.quiet && (data.tool === 'writeFile' || data.tool === 'editFile' || data.tool === 'runBash')) return data.tool;
    if (data.state === 'failed' || data.state === 'declined') return `${data.tool}:${data.state}`;
    return null;
  };
  const mine = family(entry.data);
  return mine === null || mine !== family(next.data);
}

// How many entries have settled into the feed. Settled = finished kind (a user
// message, an error, a notice), a tool line that answered, or an assistant
// entry with something newer after it — or, crucially, the assistant entry of
// a turn that has ENDED: a finished answer must land in the terminal's own
// history the moment the job is done, not wait for a next message that may
// never come (found by the stream-stability test, 3 Oct).
export function settledCount(entries: TranscriptEntry[], turnSettled = false): number {
  let count = 0;
  while (count < entries.length) {
    const entry = entries[count];
    const isLast = count === entries.length - 1;
    const settled =
      entry.kind === 'user' ||
      entry.kind === 'error' ||
      entry.kind === 'notice' ||
      entry.kind === 'reasoning' ||
      (entry.kind === 'assistant' && (!isLast || turnSettled)) ||
      (entry.kind === 'tool' && entry.data.state !== 'running' && entry.data.state !== 'awaiting');
    if (!settled || !settlesAlone(entries, count)) break;
    count += 1;
  }
  return count;
}

function FeedLine({ line, width }: { line: DisplayLine; width: number }): React.ReactElement {
  if (line.spans || line.gutter) {
    return (
      <Text>
        {line.gutter ? <Text color={ANSWER_GUTTER_COLOUR}>{ANSWER_GUTTER}</Text> : null}
        {line.text ? line.text : ' '}
      </Text>
    );
  }
  return (
    <Text color={line.own ? OWN_MESSAGE_TEXT : line.color} backgroundColor={line.own ? OWN_MESSAGE_BACKGROUND : undefined} dimColor={line.dim}>
      {line.text}
    </Text>
  );
}

// The printed conversation: settled entries only, merged where they repeat,
// each rendered exactly once.
//
// THE APPEND-ONLY RULE: <Static> remembers HOW MANY items it has printed (a
// plain count), never which. The item list must therefore only ever GROW — the
// same entry always at the same position. Deriving the list fresh from the
// transcript each render shifts positions whenever an older entry settles at a
// different rate, and Static silently skips items (the vanishing-message bug,
// 3 Oct). So the printed list is kept in a ref, only ever appended to, and the
// whole <Static> is remounted (key=epoch) when the conversation itself is
// replaced (/clear, resume).
export function Feed({ entries, width, verbose, epoch, turnSettled }: { entries: TranscriptEntry[]; width: number; verbose: boolean; epoch: number; turnSettled: boolean }): React.ReactElement {
  const printed = useRef<TranscriptEntry[]>([]);
  const settled = entries.slice(0, settledCount(entries, turnSettled));

  const settledIds = new Set(settled.map((entry) => entry.id));
  const printedIds = new Set(printed.current.map((entry) => entry.id));
  // A replaced conversation: the first settled id is older than what we printed.
  const replaced = printed.current.length > 0 && settled.length > 0 && settled[0].id < printed.current[0].id;
  if (replaced || printedIds.size !== printed.current.length) printed.current = [];
  for (const entry of settled) {
    if (!printedIds.has(entry.id)) printed.current.push(entry);
  }
  void settledIds;
  const merged = useMemo(() => mergeToolGroups(printed.current, verbose), [printed.current.length, verbose, width]);
  // How many rows the printed history occupies ON SCREEN (the click mappings
  // need the block's true position: right under the feed until the screen
  // fills, then pinned to the bottom).
  let rows_ = 0;
  for (const entry of merged) {
    if (isQuietEntry(entry, verbose)) continue;
    rows_ += entryDisplayLines(entry, width, verbose).length;
  }
  session.feedRows = rows_;
  return (
    <Static key={epoch} items={merged}>
      {(entry) => {
        if (isQuietEntry(entry, verbose)) return null;
        const lines = entryDisplayLines(entry, width, verbose);
        return (
          <React.Fragment key={entry.id}>
            {lines.map((line, index) => (
              <FeedLine key={index} line={line} width={width} />
            ))}
          </React.Fragment>
        );
      }}
    </Static>
  );
}

// The live tail: whatever is still moving, at most `max` rows, newest at the
// bottom. When the answer runs longer than the tail, one dim line says where
// the rest is - the scrollback above, reachable any time.
export function LiveTail({ entries, width, verbose, max, turnSettled }: { entries: TranscriptEntry[]; width: number; verbose: boolean; max: number; turnSettled: boolean }): React.ReactElement {
  const s = useSession();
  const visible = useMemo(() => {
    const start = settledCount(entries, turnSettled);
    return entries.slice(start);
  }, [entries, turnSettled]);
  const lines = useMemo(() => buildDisplayLines(visible, width, verbose), [visible, width, verbose]);
  const hidden = Math.max(0, lines.length - max);
  const shown = hidden > 0 ? lines.slice(hidden) : lines;
  // The click mappings need to know how many rows the tail occupies; set
  // silently (no redraw - it changes only when the tail does anyway).
  session.liveTailRows = shown.length + (hidden > 0 ? 1 : 0) + (s.showLastReasoning && s.lastReasoning ? 1 : 0);
  return (
    <React.Fragment>
      {hidden > 0 ? <Text dimColor wrap="truncate-end">{`  ↑ ${hidden} earlier lines above - scroll back any time`}</Text> : null}
      {shown.map((line, index) => (
        <FeedLine key={index} line={line} width={width} />
      ))}
      {/* The private thinking readout (/show thinking), still moving, sits here. */}
      {s.showLastReasoning && s.lastReasoning ? <Text dimColor wrap="truncate-end">{`· ${s.lastReasoning.split('\n').pop() ?? ''}`}</Text> : null}
    </React.Fragment>
  );
}
