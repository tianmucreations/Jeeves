# Jeeves

A plain-English terminal assistant: describe what you need in ordinary words and it reads files, writes files, lists folders, and runs commands for you - asking permission before anything that changes your computer.

## Platforms

Designed and built for **macOS, Windows, and Linux** from a single codebase.

- macOS is fully verified.
- Windows and Linux will be verified on those machines after the MVP, with any fixes applied to this same codebase - no platform forks.

## Quick start (local development)

1. Install Node.js 20 or later.
2. `npm install`
3. `npm run dev`

On first launch you are asked for an OpenRouter API key, which is stored securely in your operating system's credential store (macOS Keychain, Windows Credential Vault, Linux Secret Service) - never in a plain file.

## Keyboard

Everything is visible on screen: arrow keys move, Enter selects, Esc goes back. `Tab` zooms a footer metric. `Ctrl+R` reveals the model's last reasoning. Slash commands: `/model`, `/keys`, `/verbose`.

Jeeves takes over the whole terminal window (the same way vim does). The shell's own scrollback is unavailable while it runs, so the up and down arrows scroll the conversation instead - `Page Up` / `Page Down` jump a whole screen. When you quit, the terminal returns exactly as it was.

## Providers

- **OpenRouter (default).** One key unlocks 400+ models from every major provider. Get a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Repeat conversation context is cached (sticky routing), so long conversations cost a fraction of the fresh-token price.
- **Z.ai — GLM Coding Plan.** A flat-rate option for heavy daily use: from $18/month, no per-token billing. Z.ai's endpoint speaks the Anthropic protocol and Jeeves connects to it directly. To use it: subscribe at [z.ai](https://z.ai) if you want the plan, copy your Z.ai API key, then in Jeeves type `/keys`, choose Z.ai, and paste the key. Pick Z.ai in `/model` and choose a GLM model (for example GLM-5.3). Subscribing is optional - Jeeves works fine with OpenRouter alone; this is simply a money-saving option for daily drivers.
- **Ollama.** Local models, no key needed. Start the Ollama app first.

API keys are stored in your operating system's credential store - never in a plain file.
