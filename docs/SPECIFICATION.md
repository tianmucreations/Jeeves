# Jeeves - Product Specification

What Jeeves is, what it looks like, how it behaves, and how it is built.
Progress, decisions and measured results are in PROGRESS.md.

## SECTION 1 — OBJECTIVE

Build Jeeves: a cross-platform terminal CLI that behaves like Claude Code — natural-language driven, agentic, able to read and write files and run shell commands — but model-agnostic and provider-agnostic, switchable through a scrollable picker, with an extremely clean and quiet interface.
Jeeves is designed first for non-coders who want to describe what they need in plain English and have the tool do it. It is also built to be robust enough for professional developers who want simplicity without clutter.

## SECTION 2 — THE INTERFACE (WHAT IT LOOKS LIKE)

The window is divided into three fixed zones. Nothing else appears on screen.

### 2.1 Header — top of window, fixed, one line
On the left: the word Jeeves, plain text, one accent colour.
In the middle: nothing. Always empty.
On the right: the traffic-light status dot, and nothing else.
No ASCII art. No banners. No taglines. The name Jeeves appears once, here, and nowhere else in the interface.

### 2.2 Traffic Light — top-right of header
A single coloured dot showing the agent's state.
- Pulsing bright green: working — thinking, running a tool, or streaming a response.
- Solid bright red: done, idle, or waiting for input.
- Amber: waiting for the user's approval before running a tool.
- Grey: not connected — no API key, or no network.
The dot uses true-colour ANSI so the green and red are genuinely bright, not the dull terminal defaults. It pulses by alternating two shades roughly twice per second. The same state is mirrored in the terminal tab title so it can be read from another application or the window switcher. A desktop notification fires when a long job finishes while the terminal is unfocused.

### 2.3 Transcript — middle, scrolling
The transcript contains only three things:
1. What the user typed.
2. What Jeeves answered.
3. A single collapsed line per tool action.
Tool actions never expand into walls of text. They appear as one tidy line and update in place:
- Checkmark, then "Read" and the path.
- Checkmark, then "Wrote" and the number of files.
- Checkmark, then "Ran" and the command.
- Cross, then the tool name and "failed."
Reasoning is hidden. By default the user never sees the model's internal thinking. Ctrl+R reveals the last turn's reasoning. The /verbose command leaves the full trace on permanently. Default: off.
Only the answer streams visibly. Everything else happens quietly.

### 2.4 Footer — bottom of window, fixed, one line
Everything numeric lives here:
- Current model name.
- A usage bar showing how full the current limit is.
- Credit remaining, where the provider reports it.
- Tokens per minute.
The usage bar cycles through metrics when Tab is pressed: session tokens, context window percentage, daily spend, provider credit, rate-limit window.
The bar changes colour as it fills: green normally, amber past 70%, red past 90%. It shows a forecast where possible, for example "about 8 minutes until rate limit at current pace."
Where a provider reports real limits (OpenRouter credit, rate-limit headers), the bar uses them. Where it does not, it falls back to context-window percentage.

## SECTION 3 — HOW IT BEHAVES

### 3.1 Talking to It
The user types in plain English. The following examples must work:
- "Read the files in this folder."
- "What does this project do?"
- "Add a dark mode toggle to the settings page."
- "Run the tests and fix whatever fails."
No slash command is ever required to get work done. Slash commands exist as shortcuts for users who want them.

### 3.2 The Four Core Tools
Jeeves can, out of the box:
1. Read files.
2. Write files.
3. List directories.
4. Run shell commands.
Before writing a file or running a command, Jeeves asks permission. The traffic light turns amber and the user approves or declines. Reading and listing never require permission.

### 3.3 Long Conversations
When a conversation grows long, Jeeves summarises older turns automatically so it can continue without losing the thread. The user is never asked to manage context.

## SECTION 4 — MODEL AND PROVIDER SELECTION

This is a headline feature.
Pressing /model or Ctrl+M opens a full-screen picker.
- Arrow keys scroll.
- Typing filters the list instantly by fuzzy search.
- Enter selects. Esc cancels.
- Tabs switch between: Favorites, Recent, All, Tool-capable only.
Each model shows its name, identifier, context length, input and output price, whether it supports tool calling, and a rough speed indicator.

### 4.1 Providers Included
All in one scrollable list, grouped by provider:
- OpenRouter — gateway to hundreds of models. One key unlocks everything.
- Anthropic — Claude models.
- OpenAI — GPT models.
- Google — Gemini models.
- xAI — Grok models.
- Groq — fast, cheap inference.
- Mistral — Mistral models.
- Ollama — local models, no API key needed.
Models that cannot call tools are filtered out of the agent-capable list, because Jeeves needs tool calling to function.

### 4.2 Switching Mid-Conversation
If the user switches models partway through a session, Jeeves asks one question: keep the conversation, summarise it first, or start fresh.
If the new model cannot call tools, Jeeves warns and offers either a different model or a tool-free chat mode.

## SECTION 5 — API KEYS

### 5.1 First Run
On first launch, Jeeves asks a single question: "Add an API key?"
The user pastes it. It is stored securely. Done.
If the user has an OpenRouter key, that one key unlocks hundreds of models across every major provider. No other keys are needed.

### 5.2 Later
The /keys command adds, removes, or swaps keys at any time.

### 5.3 Security
Keys are stored in the operating system's own secure credential store:
- macOS: Keychain.
- Windows: Credential Vault.
- Linux: Secret Service or libsecret.
Never in a plain text file. Never in the project folder.

### 5.4 Visual Feedback
Providers without a stored key appear greyed out in the model picker with a small "Add key" hint. The user always knows what is available.

## SECTION 6 — TECHNICAL STACK

Runtime: Node.js 20 or later, TypeScript, ESM.
Dependencies:
- commander — CLI argument parsing and entrypoint.
- ink — Terminal UI, React renderer for the terminal.
- ink-select-input — Base list component for the picker.
- ink-spinner — Inline activity spinner.
- react — Required by Ink.
- ai — Vercel AI SDK, for streaming, tool calls, and multi-step loops.
- @openrouter/ai-sdk-provider — OpenRouter provider for the AI SDK.
- zod — Tool input schemas.
- execa — Shell command execution.
- fast-glob — Directory listing and file matching.
- fuse.js — Fuzzy search in the model picker.
- conf — Cross-platform config storage.
- keytar — OS credential store for API keys.
- chalk — True-colour ANSI for the traffic light and usage bar.
- node-notifier — Desktop notification on long-job completion.
Dev dependencies: typescript, tsx, @types/node, @types/react, and a test runner such as vitest.
Do not add a dependency outside this list without stating why.

## SECTION 7 — PROJECT STRUCTURE

```
jeeves/
  bin/
    jeeves — executable entrypoint
  src/
    index.tsx — commander setup and Ink render
    app.tsx — root layout: header, transcript, footer, input
    components/
      Header.tsx — "Jeeves" left, traffic light right
      TrafficLight.tsx — pulsing dot
      Footer.tsx — model, usage bar, credits, rate
      UsageBar.tsx — the filled bar with colour thresholds
      Transcript.tsx — scrolling conversation
      ToolLine.tsx — single collapsed tool action line
      Input.tsx — prompt line, slash command parsing
      ModelPicker.tsx — full-screen scroll menu
    agent/
      loop.ts — the agent loop
      context.ts — history and summarisation
      permissions.ts — approval gate for write and bash
    tools/
      index.ts — tool registry
      readFile.ts
      writeFile.ts
      listDir.ts
      runBash.ts
    providers/
      index.ts — provider registry
      types.ts — Provider interface
      openrouter.ts
      anthropic.ts
      openai.ts
      google.ts
      xai.ts
      groq.ts
      mistral.ts
      ollama.ts
    models/
      registry.ts — fetch and cache the OpenRouter model list
      filter.ts — tool-capable filtering
    platform/
      shell.ts — bash, powershell, or cmd
      paths.ts — path helpers and config locations
    keys/
      store.ts — keytar wrapper
    state/
      session.ts — in-memory session state
    commands/
      help.ts
      clear.ts
      model.ts
      keys.ts
      verbose.ts
  tests/
  package.json
  tsconfig.json
  README.md
```

## SECTION 8 — PHASE-BY-PHASE BUILD

### Phase 1 — Scaffold
Deliverables:
- package.json with ESM enabled, the bin field pointing at bin/jeeves, and scripts for dev, build, test, and start.
- tsconfig.json targeting Node 20, ESM, strict mode.
- bin/jeeves with a shebang, importing the compiled entrypoint.
- src/index.tsx using commander to accept an optional prompt argument and a version flag.
- A minimal Ink render of the three-zone layout with placeholder content.

Acceptance criteria:
- The dev command launches, draws a bordered box, and exits cleanly on Ctrl+C.
- The header shows Jeeves on the left and a static dot on the right.
- No errors on Node 20.

### Phase 2 — Provider Layer and Agent Loop
Deliverables:
- src/providers/types.ts defining a Provider interface with an id, a name, and a stream method. The stream method accepts a model ID, messages, tools, an onToken callback, and an onToolCall callback, and returns a final response.
- src/providers/openrouter.ts implementing that interface using the OpenRouter AI SDK provider and the AI SDK's streaming function, with multi-step tool looping enabled so the model can call tools repeatedly until it produces a final answer.
- src/agent/loop.ts: takes user input, appends it to history, calls the active provider, streams tokens to the transcript, dispatches tool calls, feeds results back, and terminates on a final answer.
- src/state/session.ts: holds the current model, current provider, status (idle, working, awaiting-approval, or disconnected), token counts, and cost.

Acceptance criteria:
- Typing a plain question returns a streamed answer.
- A question requiring a tool triggers the tool and continues to a final answer.
- Status transitions correctly through working, then idle.

### Phase 3 — The Four Tools
Deliverables:
Each tool is a module exporting a schema and an executor.
1. readFile — input: path. Returns file contents. No permission required.
2. listDir — input: path, and an optional recursive flag. Returns a filtered file tree, respecting .gitignore. No permission required.
3. writeFile — input: path and content. Requires permission.
4. runBash — input: command. Requires permission. Uses src/platform/shell.ts to pick the correct shell.
src/agent/permissions.ts exposes a requestApproval function that sets status to awaiting-approval, renders an amber dot, shows a compact prompt in the transcript, and resolves on y or n.

Acceptance criteria:
- "Read the files in this folder" lists the directory and summarises the contents.
- writeFile and runBash each block on an amber prompt before executing.
- Declining a permission request returns a tool error to the model and the loop continues gracefully.
- Tool schemas validate strictly. Malformed input produces a recoverable error, never an infinite loop.

### Phase 4 — The Clean Transcript
Deliverables:
- ToolLine.tsx rendering exactly one line per tool action, in the format described in Section 2.3.
- The line updates in place rather than appending a new line per state change.
- Reasoning tokens are not rendered by default. Store the last turn's reasoning in session state.
- Ctrl+R toggles display of the last turn's reasoning.
- The /verbose command toggles permanent reasoning display. Default: off.
- Only the assistant's final answer text streams into the transcript.

Acceptance criteria:
- A multi-tool task produces a tidy list of single-line entries, not a wall of output.
- No reasoning text appears unless Ctrl+R or /verbose is used.
- The transcript scrolls smoothly and the header and footer never move.

### Phase 5 — Traffic Light and Footer
Deliverables:
- TrafficLight.tsx:
  - Pulses between two true-colour greens roughly twice per second while status is working.
  - Solid bright red when idle.
  - Amber when awaiting-approval.
  - Grey when disconnected.
  - Writes the same state to the terminal tab title using the OSC escape sequence, with a plain-text label such as "working", "done", "approval", or "offline".
  - Fires a desktop notification when a job completing takes longer than 20 seconds and the terminal is not focused.
  - Cleans up its interval on unmount.
- UsageBar.tsx:
  - Renders a filled bar followed by a percentage.
  - Green below 70%, amber 70 to 89%, red 90% and above.
  - Accepts label, value, max, and unit as inputs.
- Footer.tsx:
  - One line: model name, metric bar, credit remaining, tokens per minute.
  - Tab cycles the metric through session tokens, context window percentage, daily spend, provider credit, and rate-limit window.
  - Parses OpenRouter credit and rate-limit headers where available. Falls back to context-window percentage otherwise.
  - Displays a rate forecast when derivable from recent token velocity.

Acceptance criteria:
- The dot is visibly bright and pulsing from several feet away.
- The tab title changes with status.
- The footer bar changes colour at the 70% and 90% thresholds.
- Tab cycles metrics without disturbing the transcript.

### Phase 6 — Model and Provider Picker
Deliverables:
- src/models/registry.ts: on first run, fetch the OpenRouter models list, cache the result to the config directory, and refresh weekly. Handle network failure by falling back to cache.
- src/models/filter.ts: exclude any model whose supported parameters do not include tools or tool choice.
- ModelPicker.tsx, opened by /model or Ctrl+M:
  - Full-screen view.
  - Tabs: Favorites, Recent, All, Tool-capable.
  - Arrow keys scroll. Typing fuzzy-searches. Enter selects. Esc cancels.
  - Each row shows display name, provider, context length, input and output price, tool support, and a speed indicator.
  - Providers without a stored key render greyed out with an "Add key" hint.
- On selection mid-session, prompt: keep context, summarise, or start fresh.
- If the selected model lacks tool support, warn and offer either another model or a tool-free chat mode.

Acceptance criteria:
- The picker opens instantly, scrolls smoothly with hundreds of models, and filters as you type.
- Selecting a model changes the footer immediately.
- Switching providers mid-conversation works without restarting.

### Phase 7 — Keys and Config
Deliverables:
- src/keys/store.ts wrapping keytar with setKey, getKey, deleteKey, and listProviders functions.
- First-run wizard: if no keys exist, ask "Add an API key?", then prompt for provider, then prompt for key, then store it in the OS credential store.
- /keys command: list configured providers, add, remove, or swap them.
- src/platform/paths.ts using the conf library's cross-platform defaults for config storage. Never a hardcoded home-directory path.
- Config holds the default model, favourites, recents, and the verbose flag. Never API keys.

Acceptance criteria:
- First run on a clean machine prompts for a key and stores it securely.
- /keys manages providers without a restart.
- No key is ever written to disk in plain text.
- Providers without keys appear greyed out in the picker.

### Phase 8 — Cross-Platform Correctness
Deliverables:
- src/platform/shell.ts: returns bash on macOS and Linux, and powershell on Windows, based on the operating system.
- All path handling uses the platform-independent path functions. No hardcoded forward or back slashes.
- All config and cache locations come from the conf library, not hardcoded.
- Terminal escape sequences degrade gracefully on terminals that do not support them.

Acceptance criteria:
- The project builds and runs on macOS.
- The shell adapter selects the correct shell per platform.
- No macOS-only API is used anywhere in the codebase.
- Windows and Linux are verified after the MVP on a virtual machine, with any fixes applied to the same codebase. No platform forks.

### Phase 9 — Polish, Test, Package
Deliverables:
- Slash commands: /help, /clear, /exit, /model, /keys, /verbose.
- Error handling for missing key, rate limit, network drop, malformed tool output, and permission denied.
- Tests covering tool schemas, the agent loop with a mocked provider, the model filter, and the usage bar thresholds.
- Build via pkg or bun build to produce standalone binaries.
- Publish to npm with the bin field set.
- GitHub Release with macOS installer and archive artefacts.
- README covering install, first run, and the model picker.

Acceptance criteria:
- Installing globally and running the command works on a clean machine.
- The full test suite passes.
- A non-technical user can install, add one key, and complete a file-reading task without help.

## SECTION 9 — THE AGENT LOOP

The loop is the heart of the tool and must be correct.
1. Append the user message to history.
2. Set status to working, showing a green dot.
3. Call the provider's stream method with the current history and the tool registry.
4. As tokens arrive, stream only assistant text into the transcript.
5. If the response contains tool calls:
   - For each call, check whether it needs permission.
   - If yes, set status to awaiting-approval, showing an amber dot, and wait.
   - Execute the tool. Render one collapsed tool line.
   - Append the tool result to history.
   - Repeat from step 3.
6. On a final response with no tool calls, append it, set status to idle, showing a red dot, and return control to the input.

Guardrails:
- Cap tool-call iterations per user turn, for example 25, to prevent runaway loops.
- Never auto-execute writeFile or runBash.
- Never render reasoning tokens into the transcript unless explicitly enabled.
- Never print the word Jeeves anywhere except the header.

## SECTION 10 — INTERFACE RULES, NON-NEGOTIABLE

1. The name Jeeves appears only in the top-left of the header. Nowhere else.
2. The header, footer, and input line are fixed. Only the transcript scrolls.
3. Reasoning is hidden by default.
4. Tool actions render as one line each, updated in place.
5. No banners, ASCII art, splash screens, or repeated branding.
6. No emoji except the traffic-light dot and the check and cross tool markers.
7. The interface must remain readable when the terminal is 80 columns wide.

## SECTION 11 — CROSS-PLATFORM REQUIREMENTS

- macOS, Windows, and Linux from a single codebase.
- No platform forks.
- Shell selection via the operating system check.
- Paths via the platform-independent path functions.
- Config via the conf library.
- Credentials via keytar.
- Terminal sequences degrade gracefully.
Ship for macOS first. Verify Windows and Linux after the MVP on virtual machines.

## SECTION 12 — DEFINITION OF DONE

The project is complete when:
- A non-coder can install Jeeves, add one API key, and get useful work done in plain English.
- The interface stays clean during heavy tool use.
- Switching models and providers is a scroll and a click.
- The traffic light is readable from across the room.
- The footer shows usage and credit at a glance.
- The codebase builds and runs on macOS, with Windows and Linux verified after the MVP.
- The test suite passes.
- The package is published and installable with one command.
