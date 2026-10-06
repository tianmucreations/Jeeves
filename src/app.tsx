import React, { useEffect, useInsertionEffect, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
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
import { todoLines, todosUnfinished } from './tools/todoList.js';
import { questionPanelLines, answerOption } from './agent/question.js';
import { ChatsView } from './components/ChatsView.js';
import { MemoryView } from './components/MemoryView.js';
import { RewindView } from './components/RewindView.js';
import { SpendingView } from './components/SpendingView.js';
import { ProjectPicker } from './components/ProjectPicker.js';
import { AddressPrompt } from './components/AddressPrompt.js';
import { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING } from './ink/mouse.js';
import { pressCtrlCToQuit } from './ink/quit.js';

// The main window: a rounded box border around everything. Top to bottom: plain
// top border, header row inside the box (Jeeves left, dot right), transcript
// (flexGrow), internal separator, input row, a second separator, then the info
// bar as the box's bottom content row (owner's pick A, 24 Sept: the button then
// lines up with the border and the text with no half-block tricks), and the
// plain bottom border closing under it. Budget: border 1 + header 1 +
// transcript rows-7 + separator 1 + input 1 + separator 1 + info bar 1 +
// border 1 = exactly the terminal's rows.
// The smallest window the full layout fits in: border, header, one conversation
// row, separator, typing row, border, info bar - and room to breathe.
export const MIN_ROWS = 8;
export const MIN_COLUMNS = 40;
// Erase the whole visible screen; the cursor stays put.
const CLEAR_SCREEN = '\x1b[2J';

export function App() {
  const s = useSession();
  // useWindowSize, not useStdout: it subscribes to the terminal's 'resize' event
  // and re-renders this component with the live size, so the window actually
  // grows and shrinks with the real terminal instead of freezing at whatever
  // size it happened to be when Jeeves started.
  const { columns: windowColumns, rows: windowRows } = useWindowSize();
  const rows = Math.max(windowRows ?? 24, 8);
  const columns = Math.max(windowColumns ?? 80, 40);
  const inner = columns - 2;
  // The input box grows with the message (up to MAX_INPUT_ROWS); the transcript gives
  // up the rows. A hint or question in the input row is always one row.
  const inputRows = s.approvalPending || s.transcriptScrollUp > 0 ? 1 : inputRowsFor(s.inputText, inner - 2);
  // What sits between the conversation and the typing box: a question with choices
  // waiting for the person, else the job's checklist while steps are left. The
  // conversation gives up its rows (and one more for the line above).
  const panel: { text: string; kind: 'question' | 'choice' | 'hint' | 'todo'; option?: number }[] = s.question
    ? questionPanelLines(s.question, inner - 4).map((line, index, all) => ({
        text: line.text,
        kind: line.option !== undefined ? ('choice' as const) : index === all.length - 1 ? ('hint' as const) : ('question' as const),
        option: line.option,
      }))
    : todosUnfinished(s.todos) && !s.approvalPending
      ? todoLines(s.todos, Math.min(6, Math.max(0, rows - 14))).map((text) => ({ text, kind: 'todo' as const }))
      : [];
  const midHeight = Math.max(1, rows - 6 - inputRows - (panel.length > 0 ? panel.length + 1 : 0));
  // A click on one of the choices: the panel starts on the row after the separator
  // under the conversation (border 1, header 1, conversation, separator).
  session.questionClick = (col: number, row: number) => {
    if (!session.question) return false;
    const first = 4 + midHeight;
    const line = panel[row - first];
    if (col < 2 || col > inner + 1 || line?.option === undefined) return false;
    answerOption(line.option);
    return true;
  };
  const inputSideLeft = Array.from({ length: inputRows }, () => '│ ').join('\n');
  const inputSideRight = Array.from({ length: inputRows }, () => ' │').join('\n');
  const side = '│\n'.repeat(midHeight - 1) + '│';
  const separator = '─'.repeat(inner);

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

  // The mouse is Jeeves's only on the conversation screen (wheel scrolling, drag to
  // copy). On every other screen - keys, models, help, folders, the first question -
  // it goes back to the terminal, so its own selecting and Cmd+C copy work: a web
  // address such as where to get a key can be copied (owner, 19 Sept: "I still
  // can't copy things").
  const onConversation = !(s.wizardActive || s.keysOpen || s.pickerOpen || s.helpOpen || s.chatsOpen || s.memoryOpen || s.rewindOpen || s.spendingOpen || s.settingsOpen || s.addressOpen || s.launchStage !== 'ready');
  // Settings has nothing to copy, so it keeps the mouse too: the wheel or trackpad
  // scrolls its list and a click chooses (owner, 23 Sept).
  // The address question has buttons too: its own mouse switch-on used to be undone by this
  // line a moment later (the window turned the mouse off again), so Sir and Ma'am were dead.
  const wantsMouse = onConversation || ((s.settingsOpen || s.chatsOpen || s.memoryOpen || s.rewindOpen || s.addressOpen || s.launchStage === 'address') && !(s.wizardActive || s.keysOpen || s.pickerOpen || s.helpOpen));
  // On the setup screens Ctrl+C is only for quitting - still twice, never at once.
  // (The conversation screen's typing box handles its own.)
  useInput((input, key) => {
    if (key.ctrl && input === 'c' && !onConversation) pressCtrlCToQuit();
  });

  // Which screen is showing. Every switch wipes the terminal just before the new
  // screen's first frame: Ink erases the old frame from one row too high in a
  // fullscreen frame whose cursor was shown (the same off-by-one inputFrameRow
  // corrects), so the bottom row was never erased and the old info bar's end
  // stayed on screen beside a shorter line (seen in a real pty, 23 Sept).
  // useInsertionEffect, as AlternateScreen: it is the only effect that runs
  // before Ink writes the frame. Clearing does not move the cursor, so Ink's own
  // relative moves still land where it expects.
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
      process.stdout.write(CLEAR_SCREEN);
    } catch {
      // A closed stream must never crash the app.
    }
  }, [screen]);

  useEffect(() => {
    try {
      process.stdout.write(wantsMouse ? ENABLE_MOUSE_TRACKING : DISABLE_MOUSE_TRACKING);
    } catch {
      // A closed stream must never crash the app.
    }
  }, [wantsMouse]);

  // Squeezed smaller than the box can be drawn in, a whole-looking box is
  // impossible - Ink would cut its sides off (owner, 23 Sept: "an inch from top to
  // bottom"). One plain line asks for room instead; everything comes back as it
  // was, typing included, once the window is big enough again.
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

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Text dimColor>╭{separator}╮</Text>
      <Box height={1}>
        <Text dimColor>│</Text>
        <Box width={inner} paddingLeft={1} paddingRight={1} flexDirection="column">
          <Header />
        </Box>
        <Text dimColor>│</Text>
      </Box>
      <Box height={midHeight}>
        <Box width={1} flexShrink={0}>
          <Text dimColor>{side}</Text>
        </Box>
        <Box width={inner} paddingLeft={1} paddingRight={1}>
          <Transcript width={inner - 2} />
        </Box>
        <Box width={1} flexShrink={0}>
          <Text dimColor>{side}</Text>
        </Box>
      </Box>
      {panel.length > 0 ? (
        <>
          <Text dimColor>├{separator}┤</Text>
          {panel.map((line, index) => {
            const chosen = line.kind === 'choice' && line.option === s.question?.highlight;
            return (
              <Box key={index} height={1}>
                <Text dimColor>│</Text>
                <Box width={inner} paddingLeft={1} paddingRight={1}>
                  <Text
                    wrap="truncate-end"
                    bold={line.kind === 'question'}
                    inverse={chosen}
                    color={line.kind === 'todo' && line.text.startsWith('●') ? 'yellow' : line.kind === 'choice' ? 'yellow' : undefined}
                    dimColor={line.kind === 'hint' || (line.kind === 'todo' && (line.text.startsWith('✓') || line.text.startsWith('✗')))}
                  >
                    {line.text}
                  </Text>
                </Box>
                <Text dimColor>│</Text>
              </Box>
            );
          })}
        </>
      ) : null}
      <Text dimColor>├{separator}┤</Text>
      <Box height={inputRows}>
        <Text dimColor>{inputSideLeft}</Text>
        <Box width={inner - 2}>
          <Input scrollPage={midHeight} width={inner - 2} />
        </Box>
        <Text dimColor>{inputSideRight}</Text>
      </Box>
      <Text dimColor>├{separator}┤</Text>
      <Box height={1} flexShrink={0}>
        <Text dimColor>│</Text>
        <Box width={inner} paddingLeft={1} paddingRight={1}>
          <Footer width={inner - 2} />
        </Box>
        <Text dimColor>│</Text>
      </Box>
      <Text dimColor>╰{separator}╯</Text>
      {s.toast ? (
        // Floats over the top right of the conversation; takes no room of its own.
        <Box position="absolute" marginTop={2} marginLeft={Math.max(2, columns - s.toast.text.length - 8)}>
          <Text color={s.toast.kind === 'error' ? 'red' : '#c9a96a'}>▎ </Text>
          <Text backgroundColor="#373737" color="#ffffff">{` ${s.toast.text} `}</Text>
        </Box>
      ) : null}
    </Box>
  );
}