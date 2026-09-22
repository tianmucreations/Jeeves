import React, { useEffect, useRef, useState } from 'react';
import stringWidth from 'string-width';
import { Box, Text, useCursor, useInput, usePaste, useWindowSize } from 'ink';
import { runTurn, stopTurn } from '../agent/loop.js';
import { copySelection } from '../ink/selection.js';
import { pressCtrlCToQuit } from '../ink/quit.js';
import { answerApproval, currentApprovalTrustable } from '../agent/permissions.js';
import { session, useSession } from '../state/session.js';
import { BLOCK_CURSOR, inputFrameRow } from '../ink/cursor.js';
import { isMouseSequence, handleMouseInput } from '../ink/mouse.js';
import { approvalButtons, approvalButtonAt } from '../ink/approval-buttons.js';
import { inputLayout, splitTypedBurst, cleanPaste, scrollToShowCursor, previousWordStart, nextWordEnd } from './input-layout.js';

// The rows the input box needs for the text being typed (the window makes room).
export const MAX_INPUT_ROWS = 6;
export function inputRowsFor(text: string, width: number): number {
  return text ? inputLayout(text, width, MAX_INPUT_ROWS).rows.length : 1;
}

// Sends a message, then any sent while Jeeves was busy, one after another.
async function sendAndDrain(text: string): Promise<void> {
  await runTurn(text);
  for (let next = session.takeQueued(); next !== undefined; next = session.takeQueued()) {
    await runTurn(next);
  }
}

export function Input({ scrollPage = 10, width = 76 }: { scrollPage?: number; width?: number }) {
  // The text lives in a ref as well as state: the keystroke handler reads and
  // writes the ref, so two keys arriving before React re-renders never build on
  // a stale value.
  const valueRef = useRef(session.inputText);
  const s = useSession();
  // useWindowSize so the input row and cursor track the terminal's real, live
  // size - useStdout's rows would otherwise stay frozen at the size Jeeves
  // started with (see AlternateScreen.tsx), which is what let the cursor drift
  // onto the border after a resize.
  const { rows: windowRows } = useWindowSize();
  const { setCursorPosition } = useCursor();
  // How far the box is scrolled back through a message taller than it (0 = the
  // end, where the typing is). A ref for the same reason as the text.
  const draftUpRef = useRef(0);
  const [, setDraftUp] = useState(0);
  // Where the cursor is in the message, in characters; null means at the end (as
  // Claude Code: arrows, Option+arrows for words, Ctrl+A / Ctrl+E, and a click
  // move it, and typing goes in where it is - owner, 19 Sept).
  const cursorRef = useRef<number | null>(null);
  const [, setCursorTick] = useState(0);
  // Which button is highlighted for arrow-key + Enter use (Left/Right/Tab move
  // it, Enter confirms - a mouse click still answers directly, same as
  // OpenCode's row of buttons). Reset whenever a new question replaces the last
  // one (the same "find the awaiting tool line" the window's own renderer uses).
  const awaitingId = [...s.transcript].reverse().find((entry) => entry.kind === 'tool' && entry.data.state === 'awaiting')?.id ?? null;
  const [approvalSelected, setApprovalSelected] = useState(0);
  useEffect(() => {
    setApprovalSelected(0);
  }, [awaitingId]);
  const currentApprovalButtons = s.approvalPending ? approvalButtons(currentApprovalTrustable()) : [];
  const layout = inputLayout(valueRef.current, width, MAX_INPUT_ROWS, draftUpRef.current, cursorRef.current);
  // The real cursor only at the end of the message; inside it, the highlighted
  // character is the cursor.
  const showingText = !s.approvalPending && s.transcriptScrollUp === 0 && layout.scrollUp === 0 && cursorRef.current === null;
  const scrollDraft = (up: number) => {
    draftUpRef.current = up;
    setDraftUp(up);
  };
  const chars = () => Array.from(valueRef.current);
  const moveCursor = (to: number | null) => {
    const length = chars().length;
    const next = to === null || to >= length ? null : Math.max(0, to);
    cursorRef.current = next;
    scrollDraft(scrollToShowCursor(valueRef.current, width, MAX_INPUT_ROWS, next === null ? 0 : draftUpRef.current, next));
    setCursorTick((tick) => tick + 1);
  };
  const setValue = (text: string, cursor: number | null = null) => {
    valueRef.current = text;
    session.setInputText(text);
    cursorRef.current = cursor !== null && cursor < Array.from(text).length ? cursor : null;
    // A change shows where it was made: at the end, or at the cursor inside the text.
    const up = cursorRef.current === null ? 0 : scrollToShowCursor(text, width, MAX_INPUT_ROWS, draftUpRef.current, cursorRef.current);
    if (up !== draftUpRef.current) scrollDraft(up);
  };
  // Typed or pasted text goes in at the cursor.
  const insert = (text: string) => {
    const all = chars();
    const at = cursorRef.current ?? all.length;
    const added = Array.from(text);
    setValue([...all.slice(0, at), ...added, ...all.slice(at)].join(''), cursorRef.current === null ? null : at + added.length);
  };
  // Clicking in the typing box puts the cursor there.
  session.inputClick = (col: number, row: number) => {
    const rows = windowRows ?? 24;
    const first = rows - 2 - (layout.rows.length - 1);
    const target = layout.rows[row - first];
    if (!valueRef.current || !target || target.hint || target.start === undefined) return;
    let width = 0;
    let offset = 0;
    for (const ch of Array.from(target.text)) {
      if (width >= col - 3) break;
      width += stringWidth(ch);
      offset += 1;
    }
    moveCursor(target.start + offset);
  };
  // Clicking a button answers the question directly (OpenCode's row of buttons:
  // a click and the keyboard both land on the same answer). The question always
  // draws on the single bottom input row (app.tsx forces inputRows to 1 while a
  // question is pending), so the row is fixed, not measured from typed text.
  session.approvalClick = (col: number, row: number) => {
    if (!s.approvalPending) return;
    const rows = windowRows ?? 24;
    // Same row math as the typing box above, for a single-row box (layout.rows.length 1).
    if (row !== rows - 2) return;
    const button = approvalButtonAt(currentApprovalButtons, col - 3);
    if (button) answerApproval(button.key !== 'n', button.key === 'a');
  };

  // The block cursor sits at the text insertion point: two columns in (the
  // border's │ and its padding space) plus the visible text's width, measured
  // with stringWidth so wide characters count. y is the input row, third from
  // the bottom (info bar, bottom border, input); inputFrameRow carries the +1
  // Ink's fullscreen frames need. Set during render, as Ink documents: useCursor
  // hands the position to Ink in its own useInsertionEffect, which runs before
  // this commit's frame is written - a useLayoutEffect call runs after that and
  // only lands a frame late (measured: the cursor stayed hidden when the window
  // opened). Hidden while the row shows a hint instead of the text, and while the
  // box is scrolled back through a long message (the typing point is out of view).
  // The last row of the box stays on the same terminal row however tall the box
  // grows (it grows upwards), so the cursor's row is unchanged.
  setCursorPosition(
    showingText ? { x: 2 + layout.cursorX, y: inputFrameRow(windowRows ?? 24) } : undefined
  );

  // The terminal's real cursor becomes a steady block for the whole session; it is
  // restored to the shell's default shape by the AlternateScreen exit paths.
  useEffect(() => {
    try {
      process.stdout.write(BLOCK_CURSOR);
    } catch {
      // A closed stream must never crash the app.
    }
  }, []);

  useInput((input, key) => {
    // SGR mouse events arrive as CSI chunks Ink cannot resolve; the wheel
    // scrolls the transcript and every other mouse event is consumed here so
    // none of it ever lands in the text.
    if (isMouseSequence(input)) {
      handleMouseInput(input);
      return;
    }
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen) return;
    // Ctrl+C, as Claude Code: copy a selection, else clear the typing, else stop the
    // job, else quit only when pressed twice. It used to quit at once, losing the
    // conversation - and Windows and Linux people press Ctrl+C to copy (audit, 19 Sept).
    if (key.ctrl && input === 'c') {
      if (session.selection) {
        void copySelection();
        session.setSelection(null);
      } else if (valueRef.current) {
        setValue('');
      } else if (s.status === 'working' || s.approvalPending) {
        stopTurn();
      } else {
        pressCtrlCToQuit();
      }
      return;
    }
    // Esc stops the job, as in Claude Code and the window's Stop button.
    if (key.escape && (s.status === 'working' || s.approvalPending)) {
      stopTurn();
      return;
    }
    // Any key clears a selection, as in Claude Code.
    if (session.selection) session.setSelection(null);
    if (s.approvalPending) {
      // Two ways to answer, both landing on the same result (as OpenCode's own
      // row of buttons): the letter shortcuts, or arrow keys/Tab to move the
      // highlight and Enter to confirm it.
      const answer = input.toLowerCase();
      if (answer === 'y') return void answerApproval(true);
      if (answer === 'a' && currentApprovalTrustable()) return void answerApproval(true, true);
      if (answer === 'n') return void answerApproval(false);
      if (key.leftArrow || key.tab) {
        const count = currentApprovalButtons.length;
        setApprovalSelected((current) => (current - 1 + count) % count);
        return;
      }
      if (key.rightArrow) {
        const count = currentApprovalButtons.length;
        setApprovalSelected((current) => (current + 1) % count);
        return;
      }
      if (key.return) {
        const button = currentApprovalButtons[approvalSelected];
        if (button) answerApproval(button.key !== 'n', button.key === 'a');
        return;
      }
      return;
    }
    if (key.ctrl && input === 'm') {
      s.openPicker();
      return;
    }
    if (key.ctrl && input === 'r') {
      s.toggleShowLastReasoning();
      return;
    }
    // A message taller than the box: the arrows move through the message itself
    // (as Claude Code's do when the input spans more than one line). Page Up/Down
    // and the mouse wheel still scroll the conversation.
    if ((key.upArrow || key.downArrow) && layout.maxScrollUp > 0 && s.transcriptScrollUp === 0) {
      const next = Math.min(draftUpRef.current, layout.maxScrollUp) + (key.upArrow ? 3 : -3);
      scrollDraft(Math.max(0, Math.min(next, layout.maxScrollUp)));
      return;
    }
    // Moving the cursor within the message, as in Claude Code.
    if (valueRef.current && s.transcriptScrollUp === 0) {
      const here = cursorRef.current ?? chars().length;
      if (key.leftArrow && !key.meta && !key.ctrl) return moveCursor(Math.max(0, here - 1));
      if (key.rightArrow && !key.meta && !key.ctrl) return moveCursor(here + 1);
      // Option+Left / Option+Right arrive from Terminal.app as Esc-b / Esc-f.
      if ((key.leftArrow && (key.meta || key.ctrl)) || (key.meta && input === 'b')) return moveCursor(previousWordStart(valueRef.current, here));
      if ((key.rightArrow && (key.meta || key.ctrl)) || (key.meta && input === 'f')) return moveCursor(nextWordEnd(valueRef.current, here));
      if (key.ctrl && input === 'a') return moveCursor(0);
      if (key.ctrl && input === 'e') return moveCursor(null);
    }
    // The alternate screen has no native scrollback, so these keys scroll the
    // transcript region itself (Claude Code's bindings): arrows move 3 rows,
    // Page Up/Down a full page, End jumps back to the newest and re-follows.
    if (key.upArrow) {
      s.scrollTranscript(3);
      return;
    }
    if (key.downArrow) {
      s.scrollTranscript(-3);
      return;
    }
    if (key.pageUp) {
      s.scrollTranscript(scrollPage);
      return;
    }
    if (key.pageDown) {
      s.scrollTranscript(-scrollPage);
      return;
    }
    if (key.end) {
      s.followTranscript();
      return;
    }
    // A burst of typing that ends with Enter is typing plus Enter (see splitTypedBurst).
    const burst = key.return ? { typed: '', enter: true, rest: '' } : splitTypedBurst(input);
    if (burst.enter) {
      if (burst.typed) insert(burst.typed);
      const text = valueRef.current.trim();
      setValue(burst.rest);
      if (!text) return;
      s.followTranscript();
      // /exit is honoured even mid-turn so a wedged request can never trap the user.
      if (text === '/exit' || s.status !== 'working') {
        void sendAndDrain(text);
      } else {
        // Busy: the message waits its turn and is sent as soon as this job finishes.
        session.queueMessage(text);
        session.addNotice(`Noted - I'll read this as soon as I've finished: "${text.length > 80 ? text.slice(0, 79) + '…' : text}"`);
      }
      return;
    }
    if (key.backspace || key.delete) {
      s.followTranscript();
      // The character before the cursor goes (one whole character, never half of one).
      const all = chars();
      const at = cursorRef.current ?? all.length;
      if (at === 0) return;
      setValue([...all.slice(0, at - 1), ...all.slice(at)].join(''), cursorRef.current === null ? null : at - 1);
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    s.followTranscript();
    insert(input);
  });

  // Pasted text arrives whole (bracketed paste), keeps its line breaks, and never
  // sends by itself - only Enter does.
  usePaste((text) => {
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen || s.approvalPending) return;
    s.followTranscript();
    insert(cleanPaste(text));
  });

  if (s.approvalPending) {
    // A row of buttons, not a bare y/n/a prompt: click one, or move to it with
    // the arrow keys and press Enter (the letter shortcuts still work too).
    return (
      <Text>
        {currentApprovalButtons.map((button, index) => (
          <React.Fragment key={button.key}>
            {index > 0 ? '   ' : ''}
            <Text color="yellow" inverse={index === approvalSelected} bold={index === approvalSelected}>
              {button.label}
            </Text>
          </React.Fragment>
        ))}
      </Text>
    );
  }

  // While the transcript is scrolled away from the newest, the prompt is replaced
  // by Claude Code's reading-history hint; End (or any typing) returns to the live
  // conversation.
  if (s.transcriptScrollUp > 0) {
    return <Text dimColor>reading history — press End to return</Text>;
  }

  // Trailing spaces are dimmed: invisible on screen, but it makes the frame's
  // bytes differ from the same text without them, keeping Ink on its full-frame
  // path (see input-layout.ts).
  if (!valueRef.current) {
    return <Text dimColor>{s.status === 'working' ? 'type your next message - it will be sent when I finish · Esc stops' : 'ask anything'}</Text>;
  }
  return (
    <Box flexDirection="column">
      {layout.rows.map((row, index) => {
        if (row.cursorAt !== undefined) {
          // The cursor inside the text: the character under it drawn reversed.
          const rowChars = Array.from(row.text);
          return (
            <Text key={index}>
              {rowChars.slice(0, row.cursorAt).join('')}
              <Text inverse>{rowChars[row.cursorAt] ?? ' '}</Text>
              {rowChars.slice(row.cursorAt + 1).join('')}
            </Text>
          );
        }
        return (
          <Text key={index} dimColor={row.hint}>
            {row.text}
            {row.trailingSpaces ? <Text dimColor>{row.trailingSpaces}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
