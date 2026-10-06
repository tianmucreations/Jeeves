import React, { useEffect, useInsertionEffect, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from './vendor/ink/index.js';
import { Feed, LiveTail } from './components/Transcript.js';
import { Input, inputRowsFor } from './components/Input.js';
import { Footer } from './components/Footer.js';
import { session, useSession } from './state/session.js';
import { initKeys, hasCredentials, refreshCredit, serviceKey } from './providers/index.js';
import { isDirectService, type DirectServiceId } from './providers/direct-services.js';
import { loadDirectModels } from './providers/catalogue.js';
import { getDailyLimit, getFavorites, getRecents, getRecentProjects, getDefaultModel, getDefaultProvider, getVerbosePreference } from './platform/config.js';
import { loadModels } from './models/registry.js';
import { ModelPicker } from './components/ModelPicker.js';
import { KeysManager } from './components/KeysManager.js';
import { HelpView } from './components/HelpView.js';
import { SettingsView } from './components/SettingsView.js';
import { todoHeadline } from './tools/todoList.js';
import { questionPanelLines, answerOption } from './agent/question.js';
import { stopBackgroundById } from './tools/background.js';
import { ChatsView } from './components/ChatsView.js';
import { MemoryView } from './components/MemoryView.js';
import { RewindView } from './components/RewindView.js';
import { SpendingView } from './components/SpendingView.js';
import { ProjectPicker } from './components/ProjectPicker.js';
import { AddressPrompt } from './components/AddressPrompt.js';
import { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING, setMouseRestore, endHandOff } from './ink/mouse.js';
import { pressCtrlCToQuit } from './ink/quit.js';
import { setCursorRowListener, askCursorRowSoon } from './ink/cursor-report.js';

// The main window, the Claude Code way (3 Oct): finished conversation text is
// printed into the terminal's own history by <Feed> (see Transcript.tsx) and
// the LIVE BLOCK under it holds only what is still moving - the answer being
// written, the step in progress, the background-tasks panel, the question
// waiting, the typing box and the info bar. The terminal's own scrolling,
// selection and copy reach everything, at all times, mid-answer included.
export const MIN_ROWS = 6;
export const MIN_COLUMNS = 40;

export function App() {
  const s = useSession();
  // useWindowSize, not useStdout: it subscribes to the terminal's 'resize' event
  // and re-renders this component with the live size, so the window actually
  // grows and shrinks with the real terminal.
  const { columns: windowColumns, rows: windowRows } = useWindowSize();
  const rows = Math.max(windowRows ?? 24, 6);
  const columns = Math.max(windowColumns ?? 80, 40);
  // The live tail shows the last few rows of a growing answer; the rest is
  // already in the terminal's history, one scroll away.
  const tailMax = Math.max(2, Math.min(12, rows - 6));
  const inputRows = s.approvalPending ? 1 : inputRowsFor(s.inputText, columns);
  // The one-line checklist (the bullet-point boxes are gone): the step in
  // progress, updating in place, gone the moment the job is done.
  const headline = !s.approvalPending && !s.question ? todoHeadline(s.todos) : null;
  // The background-tasks panel: the door behind the blue note in the info bar.
  const tasksRows = s.tasksOpen && s.backgroundTasks.length > 0 ? s.backgroundTasks : [];
  // The question rows (question, choices, hint), drawn compact - no box.
  const questionLines: { text: string; kind: 'question' | 'choice' | 'hint'; option?: number }[] = s.question
    ? questionPanelLines(s.question, columns - 2).map((line, index, all) => ({
        text: line.text,
        kind: line.option !== undefined ? ('choice' as const) : index === all.length - 1 ? ('hint' as const) : ('question' as const),
        option: line.option,
      }))
    : [];
  // Heights of the live block, so a click can find its row: tail + checklist +
  // tasks panel + question + typing + info bar. In the normal buffer the block
  // sits right under the printed history until the screen fills; after that it
  // is pinned to the bottom.
  const blockHeight = s.liveTailRows + (headline ? 1 : 0) + tasksRows.length + questionLines.length + 1 + inputRows + 1 + 1;
  const blockTop = Math.min(s.feedRows + 1, rows - blockHeight + 1);
  // Where the info bar is on screen (the buttons' click row); the typing area is two rows above it.
  session.blockHeight = blockHeight;
  session.estimatedTop = blockTop;
  useEffect(() => {
    setCursorRowListener((row) => {
      session.cursorRow = row;
    });
    return () => setCursorRowListener(null);
  }, []);
  // A RESIZE RE-WRAPS EVERYTHING (6 Oct, seen in a real Terminal window: after a drag
  // the printed conversation was gone and only the live block was left). Once the
  // dragging stops, the screen and its scrollback are wiped and the whole
  // conversation is printed again at the new width - what Claude Code does.
  const sizeKey = `${columns}x${rows}`;
  const firstSize = useRef(true);
  useEffect(() => {
    if (firstSize.current) {
      firstSize.current = false;
      return;
    }
    const timer = setTimeout(() => {
      try {
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      } catch {
        // A closed stream must never crash the app.
      }
      session.screenReset?.();
      session.reprintHistory();
    }, 300);
    return () => clearTimeout(timer);
  }, [sizeKey]);
  // After every frame, ask the terminal where the cursor ended up.
  useEffect(() => {
    askCursorRowSoon();
  });
  const rule = '─'.repeat(columns);
  // Counted up from the info bar, which the terminal has told us the row of: the
  // rule, the typing area, the rule, then the question's rows, then the tasks'.
  const questionFirst = () => session.footerRow - 1 - inputRows - 1 - questionLines.length;
  // A click on one of the question's choices.
  session.questionClick = (col: number, row: number) => {
    void col;
    const first = questionFirst();
    const line = questionLines[row - first];
    return line?.option !== undefined ? (answerOption(line.option), true) : false;
  };
  // A click on a task's Stop button.
  session.tasksClick = (col: number, row: number) => {
    const first = session.blockTop + s.liveTailRows + (headline ? 1 : 0);
    const task = tasksRows[row - first];
    if (!task) return false;
    void col;
    if (col >= columns - 6) {
      stopBackgroundById(task.id);
      return true;
    }
    return false;
  };

  useEffect(() => {
    session.setFavorites(getFavorites());
    session.setDailyLimit(getDailyLimit());
    session.setRecents(getRecents());
    session.setRecentProjects(getRecentProjects());
    if (getVerbosePreference()) session.setVerbose(true);
    const defaultModel = getDefaultModel();
    if (defaultModel) session.setModel(defaultModel);
    const defaultProvider = getDefaultProvider();
    if (defaultProvider) session.setProvider(defaultProvider);
    void loadModels().then(({ models, error }) => session.setModels(models, error));
    // Keys resolve from the Mac keychain first; the first-run wizard now starts
    // after the project is chosen (the project list always shows first).
    void initKeys().then(() => {
      // A direct connection's models (memory sizes, prices) load in the background.
      const directKey = isDirectService(session.providerId) ? serviceKey(session.providerId) : null;
      if (directKey) void loadDirectModels(session.providerId as DirectServiceId, directKey).catch(() => {});
      if (hasCredentials()) {
        void refreshCredit();
      } else {
        session.setStatus('disconnected');
      }
    });
  }, []);

  // THE MOUSE POLICY (6 Oct): the buttons need mouse reports, the terminal's own
  // scrolling and selecting need them OFF. Reporting is on, and the first turn of
  // the wheel or click in the printed history hands the mouse to the terminal for a
  // few seconds (see handOffToTerminal in ink/mouse.ts). Help and the spending
  // screen keep it off for good: they are for reading and copying.
  const onConversation = !(s.wizardActive || s.keysOpen || s.pickerOpen || s.helpOpen || s.chatsOpen || s.memoryOpen || s.rewindOpen || s.spendingOpen || s.settingsOpen || s.addressOpen || s.launchStage !== 'ready');
  const wantsMouse = !(s.helpOpen || s.spendingOpen);
  const wantsMouseRef = useRef(wantsMouse);
  wantsMouseRef.current = wantsMouse;
  // On the setup screens Ctrl+C is only for quitting - still twice, never at once.
  // (The conversation screen's typing box handles its own.)
  useInput((input, key) => {
    if (key.ctrl && input === 'c' && !onConversation) pressCtrlCToQuit();
  });

  // Which screen is showing. A switch wipes the terminal just before the new
  // screen's first frame, so the old screen never lingers above the new one.
  const tooSmall = (windowRows ?? 24) < MIN_ROWS || (windowColumns ?? 80) < MIN_COLUMNS;
  const screen = tooSmall
    ? 'small'
    : s.wizardActive
      ? 'wizard'
      : s.keysOpen
        ? 'keys'
        : s.pickerOpen
          ? 'picker'
          : s.helpOpen
            ? 'help'
            : s.chatsOpen
              ? 'chats'
              : s.memoryOpen
                ? 'memory'
                : s.rewindOpen
                  ? 'rewind'
                  : s.spendingOpen
                    ? 'spending'
                    : s.settingsOpen
                ? 'settings'
                : s.addressOpen || s.launchStage === 'address'
                  ? 'address'
                  : s.launchStage === 'project'
                    ? 'project'
                    : 'conversation';
  const firstScreen = useRef(true);
  useInsertionEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    try {
      session.screenReset?.();
    } catch {
      // A closed stream must never crash the app.
    }
  }, [screen]);

  useEffect(() => {
    setMouseRestore(() => {
      try {
        process.stdout.write(wantsMouseRef.current ? ENABLE_MOUSE_TRACKING : DISABLE_MOUSE_TRACKING);
      } catch {
        // A closed stream must never crash the app.
      }
    });
    return () => setMouseRestore(null);
  }, []);
  useEffect(() => {
    endHandOff();
  }, [screen]);
  useEffect(() => {
    try {
      process.stdout.write(wantsMouse ? ENABLE_MOUSE_TRACKING : DISABLE_MOUSE_TRACKING);
    } catch {
      // A closed stream must never crash the app.
    }
  }, [wantsMouse]);

  // Squeezed too small to draw anything readable, one plain line asks for room;
  // everything comes back as it was once the window is big enough again.
  if (tooSmall) {
    return (
      <Text dimColor wrap="truncate-end">
        Make the window a little bigger to see Jeeves
      </Text>
    );
  }

  if (s.wizardActive) {
    return <KeysManager mode="wizard" rows={rows} columns={columns} />;
  }
  if (s.keysOpen) {
    return <KeysManager mode="manage" rows={rows} columns={columns} />;
  }
  if (s.pickerOpen) {
    return <ModelPicker rows={rows} columns={columns} />;
  }
  if (s.helpOpen) {
    return <HelpView rows={rows} />;
  }
  if (s.chatsOpen) {
    return <ChatsView rows={rows} />;
  }
  if (s.memoryOpen) {
    return <MemoryView rows={rows} />;
  }
  if (s.rewindOpen) {
    return <RewindView rows={rows} />;
  }
  if (s.spendingOpen) {
    return <SpendingView rows={rows} />;
  }
  if (s.settingsOpen) {
    return <SettingsView rows={rows} />;
  }
  if (s.addressOpen || s.launchStage === 'address') {
    return <AddressPrompt rows={rows} />;
  }
  if (s.launchStage === 'project') {
    return <ProjectPicker rows={rows} columns={columns} />;
  }

  const minutes = (startedAt: number) => {
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  };

  // A turn that has ended (idle, no question waiting) hands its answer to the
  // terminal's history straight away - it must not wait for a next message
  // that may never come.
  const turnSettled = s.status === 'idle' && !s.approvalPending && !s.question;

  return (
    <React.Fragment>
      {/* Everything finished lives in the terminal's own history from here up. */}
      <Feed entries={s.transcript} width={columns} verbose={s.verbose} epoch={s.feedEpoch} turnSettled={turnSettled} />
      {/* The live block: only what is still moving. */}
      <LiveTail entries={s.transcript} width={columns} verbose={s.verbose} max={tailMax} turnSettled={turnSettled} />
      {headline ? (
        <Text dimColor wrap="truncate-end">
          {`  ▣ ${headline}`}
        </Text>
      ) : null}
      {tasksRows.map((task) => (
        <Box key={task.id} width={columns} justifyContent="space-between">
          <Text wrap="truncate-end">{`  #${task.id} ${task.plain} · ${minutes(task.startedAt)}`}</Text>
          <Text color="yellow" inverse>
            {' Stop '}
          </Text>
        </Box>
      ))}
      {questionLines.map((line, index) => {
        const chosen = line.kind === 'choice' && line.option === s.question?.highlight;
        return (
          <Text
            key={index}
            wrap="truncate-end"
            bold={line.kind === 'question'}
            inverse={chosen}
            color={line.kind === 'choice' ? 'yellow' : undefined}
            dimColor={line.kind === 'hint'}
          >
            {line.text}
          </Text>
        );
      })}
      <Text dimColor>{rule}</Text>
      <Input width={columns} />
      <Text dimColor>{rule}</Text>
      <Footer width={columns} />
      {s.toast ? (
        // Floats over the top right of the live block; takes no room of its own.
        <Box position="absolute" marginTop={1} marginLeft={Math.max(2, columns - s.toast.text.length - 8)}>
          <Text color={s.toast.kind === 'error' ? 'red' : '#c9a96a'}>▎ </Text>
          <Text backgroundColor="#373737" color="#ffffff">{` ${s.toast.text} `}</Text>
        </Box>
      ) : null}
    </React.Fragment>
  );
}
