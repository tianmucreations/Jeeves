import React, { useEffect, useRef, useState } from 'react';
import stringWidth from 'string-width';
import { Box, Text, useInput, usePaste, useWindowSize } from '../vendor/ink/index.js';
import { runTurn, stopTurn } from '../agent/loop.js';
import { pressCtrlCToQuit } from '../ink/quit.js';
import { answerApproval, currentApprovalTrustable } from '../agent/permissions.js';
import { readClipboardImage, pickPictureFile, imagePathsIn, loadImageFile, tooBig, type ImageAttachment } from '../platform/images.js';
import { answerOption, answerQuestion } from '../agent/question.js';
import { session, useSession } from '../state/session.js';
import { getInputHistory, pushInputHistory } from '../platform/config.js';
import { isMouseSequence, subscribeMouse, handleMouseInput } from '../ink/mouse.js';
import { approvalButtons, approvalButtonAt } from '../ink/approval-buttons.js';
import { inputLayout, splitTypedBurst, cleanPaste, scrollToShowCursor, previousWordStart, nextWordEnd } from './input-layout.js';

// The rows the input box needs for the text being typed (the window makes room).
export const MAX_INPUT_ROWS = 6;
export function inputRowsFor(text: string, width: number): number {
  return text ? inputLayout(text, width, MAX_INPUT_ROWS).rows.length : 1;
}

// Sends a message, then any sent while Jeeves was busy, one after another.
async function sendAndDrain(text: string, images: ImageAttachment[] = []): Promise<void> {
  await runTurn(text, images);
  for (let next = session.takeNext(); next !== undefined; next = session.takeNext()) {
    await runTurn(next.text, next.images);
  }
}

// The pictures a message actually uses: those whose [Image N] marker is still in the text
// (deleting the marker leaves the picture out).
function picturesUsed(text: string): ImageAttachment[] {
  const used = new Set<number>();
  for (const match of text.matchAll(/\[Image (\d+)\]/g)) used.add(Number(match[1]) - 1);
  return [...used].filter((index) => session.attachments[index]).sort((a, b) => a - b).map((index) => session.attachments[index]);
}

export function Input({ width = 76 }: { width?: number }) {
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
  // How far the box is scrolled back through a message taller than it (0 = the
  // end, where the typing is). A ref for the same reason as the text.
  const draftUpRef = useRef(0);
  const [, setDraftUp] = useState(0);
  // Where the cursor is in the message, in characters; null means at the end (as
  // Claude Code: arrows, Option+arrows for words, Ctrl+A / Ctrl+E, and a click
  // move it, and typing goes in where it is - owner, 19 Sept).
  const cursorRef = useRef<number | null>(null);
  const [, setCursorTick] = useState(0);
  // OpenCode's input history: what has been sent, so Up at the start of the box
  // walks back through previous messages. index null = not navigating (and draft
  // holds what was being typed, brought back by Down past the newest).
  // Read once (a plain useRef(getInputHistory()) would read the settings file on every draw).
  const sentHistory = useRef<string[]>(null as unknown as string[]);
  if (sentHistory.current === null) sentHistory.current = getInputHistory();
  const historyNav = useRef<{ index: number | null; draft: string }>({ index: null, draft: '' });
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
  const showingText = !s.approvalPending && layout.scrollUp === 0 && cursorRef.current === null;
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
  // Typed or pasted text goes in at the cursor. Editing a recalled message ends
  // the walk through history - the text stays as it now is.
  const insert = (text: string) => {
    historyNav.current.index = null;
    const all = chars();
    const at = cursorRef.current ?? all.length;
    const added = Array.from(text);
    setValue([...all.slice(0, at), ...added, ...all.slice(at)].join(''), cursorRef.current === null ? null : at + added.length);
  };
  // A picture joins the message: it shows as [Image N] where the cursor is.
  const attachPicture = (image: ImageAttachment) => {
    if (tooBig(image)) {
      session.addNotice(`${image.name} is over the 5 MB a picture can be. Shrink it or take a smaller screenshot.`);
      return;
    }
    const number = session.attachments.length + 1;
    session.setAttachments([...session.attachments, image]);
    insert(`[Image ${number}] `);
    session.showToast('Picture added');
  };
  // The Picture button: the computer's own "choose a picture" window opens (never a
  // surprise picture from the clipboard - that is what pasting is for).
  session.pictureButton = () => {
    void (async () => {
      const file = await pickPictureFile();
      if (!file) return;
      const loaded = await loadImageFile(file);
      if (loaded.ok) attachPicture(loaded.image);
      else session.addNotice(loaded.reason);
    })();
  };
  // Clicking in the typing box puts the cursor there (mouse reporting is only
  // on when there is something to click - a question or a screen - so this
  // fires then; in plain conversation the terminal's own selection is active).
  session.inputClick = (col: number, row: number) => {
    const rows = windowRows ?? 24;
    // The typing rows sit directly above the info bar (no border since the
    // conversation moved into the terminal's own scrollback).
    const first = session.footerRow - 2 - (layout.rows.length - 1);
    const target = layout.rows[row - first];
    if (!valueRef.current || !target || target.hint || target.start === undefined) return;
    let textWidth = 0;
    let offset = 0;
    for (const ch of Array.from(target.text)) {
      if (textWidth >= col - 1) break;
      textWidth += stringWidth(ch);
      offset += 1;
    }
    moveCursor(target.start + offset);
  };
  // The wheel over the typing box reads back through a message taller than it,
  // one row per turn of the wheel (wherever the mouse is live at all).
  session.inputWheel = (row: number, up: boolean) => {
    if (s.approvalPending || layout.maxScrollUp === 0) return false;
    const first = session.footerRow - 2 - (layout.rows.length - 1);
    if (row < first || row > session.footerRow - 2) return false;
    const next = Math.min(draftUpRef.current, layout.maxScrollUp) + (up ? 1 : -1);
    scrollDraft(Math.max(0, Math.min(next, layout.maxScrollUp)));
    return true;
  };
  // THE CURSOR IS DRAWN, NOT ASKED FOR (26 Sept). Claude Code does it this way: the
  // visible cursor is an inverted character in the text (Cursor.ts, invert()),
  // and it never depends on where the terminal thinks its own cursor is - which
  // Ink works out with relative moves that were off by one or two rows on
  // several screens, and whose shape Terminal.app ignores. The terminal's real
  // cursor stays hidden; the block below is part of the frame, so it is always
  // exactly where the typing point is. Inside the text the highlighted character
  // is the cursor (cursorAt).
  // A click and the keyboard land on the same answer: Allow once, Always Allow,
  // Decline. Y / A / N do the same from the keyboard.
  const answerFromButton = (button: { key: 'y' | 'a' | 'n' }) => {
    answerApproval(button.key !== 'n', button.key === 'a' ? 'project' : 'once');
  };
  // Clicking a button answers the question directly (OpenCode's row of buttons:
  // a click and the keyboard both land on the same answer). The question always
  // draws on the single bottom input row (app.tsx forces inputRows to 1 while a
  // question is pending), so the row is fixed: directly above the info bar.
  session.approvalClick = (col: number, row: number) => {
    if (!s.approvalPending) return;
    const rows = windowRows ?? 24;
    if (row !== session.footerRow - 2) return;
    const button = approvalButtonAt(currentApprovalButtons, col - 1);
    if (button) answerFromButton(button);
  };

  // The mouse only reaches the typing box where reporting is on (a question or
  // a screen is up); in plain conversation the terminal's own selection and
  // scrolling are active, which is the point of the move to the scrollback.
  useEffect(() => subscribeMouse(handleMouseInput), []);

  useInput((input, key) => {
    // (Mouse reports no longer arrive here - see subscribeMouse below.)
    if (isMouseSequence(input)) return;
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen || s.chatsOpen || s.memoryOpen || s.rewindOpen || s.spendingOpen) return;
    // Ctrl+C, as Claude Code: clear the typing, else stop the job, else quit only
    // when pressed twice. Selecting and copying is the terminal's own now (drag
    // + Cmd+C), so Ctrl+C has nothing to copy.
    if (key.ctrl && input === 'c') {
      if (valueRef.current) {
        setValue('');
      } else if (s.busy()) {
        stopTurn();
      } else {
        pressCtrlCToQuit();
      }
      return;
    }
    // Esc closes the background-tasks panel first (a panel is not a job).
    if (key.escape && s.tasksOpen) {
      s.setTasksOpen(false);
      return;
    }
    // Esc stops the job, as in Claude Code and the window's Stop button.
    if (key.escape && s.busy()) {
      stopTurn();
      return;
    }
    // A question with choices is waiting: a number picks a choice, the arrows move the
    // highlight and Enter takes it (all while nothing is typed); typed words are
    // an answer of their own and go in at Enter below.
    if (session.question && !valueRef.current) {
      const count = session.question.options.length;
      const highlight = session.question.highlight;
      if (/^[1-9]$/.test(input) && answerOption(Number(input) - 1)) return;
      if (key.upArrow) return void session.setQuestionHighlight((highlight - 1 + count) % count);
      if (key.downArrow) return void session.setQuestionHighlight((highlight + 1) % count);
      if (key.return) return void answerOption(highlight);
    }
    if (s.approvalPending) {
      // Two ways to answer, both landing on the same result (as OpenCode's own
      // row of buttons): the letter shortcuts, or arrow keys/Tab to move the
      // highlight and Enter to confirm it.
      const answer = input.toLowerCase();
      if (answer === 'y') return void answerApproval(true);
      if (answer === 'a' && currentApprovalTrustable()) return void answerApproval(true, 'project');
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
        if (button) answerFromButton(button);
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
    // (as Claude Code's do when the input spans more than one line).
    if ((key.upArrow || key.downArrow) && layout.maxScrollUp > 0) {
      const next = Math.min(draftUpRef.current, layout.maxScrollUp) + (key.upArrow ? 3 : -3);
      scrollDraft(Math.max(0, Math.min(next, layout.maxScrollUp)));
      return;
    }
    // Moving the cursor within the message, as in Claude Code.
    if (valueRef.current) {
      const here = cursorRef.current ?? chars().length;
      if (key.leftArrow && !key.meta && !key.ctrl) return moveCursor(Math.max(0, here - 1));
      if (key.rightArrow && !key.meta && !key.ctrl) return moveCursor(here + 1);
      // Option+Left / Option+Right arrive from Terminal.app as Esc-b / Esc-f.
      if ((key.leftArrow && (key.meta || key.ctrl)) || (key.meta && input === 'b')) return moveCursor(previousWordStart(valueRef.current, here));
      if ((key.rightArrow && (key.meta || key.ctrl)) || (key.meta && input === 'f')) return moveCursor(nextWordEnd(valueRef.current, here));
      if (key.ctrl && input === 'a') return moveCursor(0);
      if (key.ctrl && input === 'e') return moveCursor(null);
    }
    // Up-arrow history, as Claude Code and OpenCode both do it: with the cursor
    // at the very start of the box (an empty box counts), Up walks back through
    // previous messages to resend or edit one; Down walks forward, and past the
    // newest brings back what was being typed. Anywhere else, Up and Down are
    // the terminal's own business now (the conversation above scrolls natively).
    {
      const navigating = historyNav.current.index !== null;
      const atStart = navigating || cursorRef.current === 0 || !valueRef.current;
      if (key.upArrow && atStart && sentHistory.current.length > 0 && layout.maxScrollUp === 0) {
        const state = historyNav.current;
        if (state.index === null) {
          state.draft = valueRef.current;
          state.index = sentHistory.current.length - 1;
        } else {
          state.index = Math.max(0, state.index - 1);
        }
        setValue(sentHistory.current[state.index], 0);
        return;
      }
      if (key.downArrow && navigating) {
        const state = historyNav.current;
        state.index = (state.index ?? 0) + 1;
        if (state.index >= sentHistory.current.length) {
          state.index = null;
          setValue(state.draft);
        } else {
          setValue(sentHistory.current[state.index], 0);
        }
        return;
      }
    }
    // A burst of typing that ends with Enter is typing plus Enter (see splitTypedBurst).
    const burst = key.return ? { typed: '', enter: true, rest: '' } : splitTypedBurst(input);
    if (burst.enter) {
      if (burst.typed) insert(burst.typed);
      const text = valueRef.current.trim();
      setValue(burst.rest);
      if (!text) return;
      // Sent messages are remembered for Up-arrow recall (OpenCode's history).
      pushInputHistory(text);
      sentHistory.current = getInputHistory();
      historyNav.current = { index: null, draft: '' };
      // Words typed while a question waits are the answer.
      if (session.question) {
        answerQuestion(text);
        return;
      }
      const pictures = picturesUsed(text);
      session.setAttachments([]);
      // /exit is honoured even mid-turn so a wedged request can never trap the user.
      if (text === '/exit' || !s.busy()) {
        void sendAndDrain(text, pictures);
      } else {
        // Busy: the message waits its turn and is sent as soon as this job finishes.
        session.queueMessage(text, pictures);
        session.addNotice(`Noted - I'll read this as soon as I've finished: "${text.length > 80 ? text.slice(0, 79) + '…' : text}"`);
      }
      return;
    }
    if (key.backspace || key.delete) {
      historyNav.current.index = null;
      // The character before the cursor goes (one whole character, never half of one).
      const all = chars();
      const at = cursorRef.current ?? all.length;
      if (at === 0) return;
      setValue([...all.slice(0, at - 1), ...all.slice(at)].join(''), cursorRef.current === null ? null : at - 1);
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    insert(input);
  });

  // Pasted text arrives whole (bracketed paste), keeps its line breaks, and never
  // sends by itself - only Enter does.
  usePaste((text) => {
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen || s.chatsOpen || s.memoryOpen || s.rewindOpen || s.spendingOpen || s.approvalPending) return;
    const pasted = cleanPaste(text);
    // Nothing came as text: it may be a screenshot on the clipboard (Cmd+V in a Mac
    // terminal sends an empty paste for one).
    if (!pasted.trim()) {
      void readClipboardImage().then((image) => {
        if (image) attachPicture(image);
      });
      return;
    }
    // A dropped picture file arrives as its address: it becomes a picture, not typed words.
    const files = imagePathsIn(pasted);
    if (files.length > 0 && pasted.trim().split(/\s+/).length <= files.length * 4) {
      void (async () => {
        for (const file of files) {
          const loaded = await loadImageFile(file);
          if (loaded.ok) attachPicture(loaded.image);
          else session.addNotice(loaded.reason);
        }
      })();
      return;
    }
    insert(pasted);
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

  // While the background-tasks panel is open, the typing row keeps typing - the
  // panel closes with Esc, /tasks, or its own Stop buttons.

  // An empty box shows nothing but the cursor at the typing point - no hint
  // words for it to sit on (owner, 24 Sept). A single space keeps the row at
  // one line tall (an empty Ink line has no height).
  if (!valueRef.current) {
    return <Text inverse>{' '}</Text>;
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
            {showingText && index === layout.rows.length - 1 ? <Text inverse>{' '}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
