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

Everything is visible on screen: arrow keys move, Enter selects, Esc goes back. The bottom bar shows the model at work, what you've spent today, and what's left on your account; warnings appear there only when something needs you. `Ctrl+R` reveals the model's last reasoning. Slash commands: `/model`, `/keys`, `/verbose`.

Jeeves takes over the whole terminal window (the same way vim does). The shell's own scrollback is unavailable while it runs, so the trackpad, mouse wheel, and up and down arrows scroll the conversation instead - `Page Up` / `Page Down` jump a whole screen and `End` returns to the newest. To select text for copying, hold `Fn` while dragging in Terminal.app (`Option` in iTerm2, `Shift` in most other terminals). When you quit, the terminal returns exactly as it was.

## Providers

- **OpenRouter (default).** One key unlocks 400+ models from every major provider. Get a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Repeat conversation context is cached (sticky routing), so long conversations cost a fraction of the fresh-token price.
- **Z.ai — GLM Coding Plan.** A flat-rate option for heavy daily use: from $18/month, no per-token billing. Jeeves connects to the GLM Coding Plan endpoint (api.z.ai/api/coding/paas/v4), so the subscription quota is used, not pay-per-token billing. To use it: subscribe at [z.ai](https://z.ai) if you want the plan, copy your Z.ai API key, then in Jeeves type `/model`, choose Z.ai, press Enter, and paste the key when asked (it is stored in the Mac Keychain); the GLM model list appears immediately. The key can also be managed with `/keys`. Subscribing is optional - Jeeves works fine with OpenRouter alone; this is simply a money-saving option for daily drivers.
- **Ollama.** Local models, no key needed. Start the Ollama app first.

API keys are stored in your operating system's credential store - never in a plain file.
