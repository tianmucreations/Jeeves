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
