# Jeeves

**Your personal assistant in the terminal — built for non-coders and coders alike. Say what you need in plain English; Jeeves does the work, carefully, and tells you what it cost.**

Jeeves reads and writes your files, tidies folders, builds web pages, fixes programs and checks facts on the web — all from one calm window, in ordinary language. He asks before changing anything, can put things back with `/undo`, and keeps an eye on your costs. No commands to learn, no settings to fiddle with — and if you do code, every model and every detail is there when you want it.

```
npm install -g @tianmucreations/jeeves
jeeves
```

Needs [Node.js](https://nodejs.org) 22.12 or newer, and a key from an AI service — one [OpenRouter](https://openrouter.ai/settings/keys) key is all it takes.

---

## What you can ask him

- "Write a polite letter to my landlord about the broken boiler and save it as letter.txt."
- "Tidy my Downloads folder: pictures in one place, documents in another, spreadsheets in a third."
- "Make a one-page website for my bakery with our opening hours and prices."
- "From hours.csv, make an invoice for my client Brightside, with a total at the bottom."
- "Our phone number changed — update it everywhere on the website, however it's written."
- "What's the latest version of Node.js?" — he looks it up and tells you where he found it.

## Why people choose Jeeves

**Built for people who don't code.** Every screen is a list you move through with the arrow keys and Enter. Open a recent project or create a new one from a list — no typing folder locations, no jargon, no hidden shortcuts. Errors come in plain English ("OpenAI didn't accept the key — type /keys to check or replace it"), never as codes.

**A butler, not a chatbot.** Jeeves is polite, unflappable and discreet, in the tradition of P.G. Wodehouse — and he calls you whatever you like (he asks on first launch; `/address` changes it). He answers questions directly, gets on with jobs when asked, and says plainly when something is done.

**Auto: the right model, without thinking about it.** Choose Auto and Jeeves works with a fast, inexpensive model, calls in an expert model when a job gets hard, and has the expert double-check finished programs and documents before telling you they're done. The expert must show a concrete example of any problem, and Jeeves must see the problem for himself before changing anything, so good work is never "fixed" into bad work. If the job still proves difficult, he asks before using the strongest (and dearest) model.

**He doesn't guess.** Facts about the outside world are looked up on the web, read from the most official page, and given with their source. Before building something new, he checks what already exists and shows you a short research note: use an existing tool, adapt one (licence permitting), or build new — and why. If the same problem happens twice, he researches the cause instead of patching blindly.

**Safe to say yes to.** Anything that changes your computer asks first. Before any change in your project folder he quietly takes a backup, so `/undo` puts the folder back — changed and deleted files return, new ones disappear. Changes outside the folder come with a warning, because they can't be undone.

**Honest about costs.** A daily spending limit (you choose it; $3 to start) stops and asks before going over, and a long job checks in every 50 cents. Nothing is spent without you seeing it — and it can cost nothing at all: OpenRouter's free models, or models running on your own computer with Ollama.

**Your keys stay private.** Keys are kept in your computer's own secure keychain, never in a plain file.

**See from across the room whether he's finished.** A traffic light in the top right of the window pulses green while Jeeves is working, turns amber when he needs your OK, and shows red when he's done and waiting for you. The same status appears in the Terminal tab's title, so you can see it from another app — and on a Mac a notification tells you when a long job has finished.

**An information bar that only speaks when it matters.** Along the bottom: the model at work (in Auto, which one is working right now), what today has cost against your limit, and — with OpenRouter — what's left on your account. Warnings — credit running low, the limit reached — appear only when something needs you.

**Every step visible, never noisy.** Each action is one tidy line that updates in place — "✓ Read letter.txt", "✓ Wrote 1 file" — and research notes are shown in full. The model's thinking stays out of the way unless you ask for it (`Ctrl+R`).

## For people who do code

- **Any model, your choice.** Turn Auto off and pick from 400+ models through OpenRouter, with search, favourites, prices, memory sizes and a free-models list.
- **Direct connections** with your own key: Anthropic, OpenAI, Google, xAI (Grok), Mistral and Groq — each company's live model list, with costs worked out from its price list. Plus **any OpenAI-compatible service** (paste its address and key), **Ollama** for models on your own machine, and **Z.ai's GLM Coding Plan** at a flat monthly price.
- **Prompt caching** where it matters: sticky routing on OpenRouter, and cache markers on Anthropic, so long conversations cost a fraction of the fresh price.
- **Runs your real tools** — tests, builds, git — and reads the results before claiming a job is done.
- **Tested on every change** on macOS, Windows and Linux.

## Where Auto is available

| Service | Auto | Everyday model + expert |
|---|---|---|
| OpenRouter | Yes | DeepSeek V4 Flash + Claude Sonnet 5 |
| OpenAI (your key) | Yes | GPT-5.6 Luna + GPT-5.6 Terra |
| Google (your key) | Yes | Gemini 3.8 Flash + Gemini 3.5 Flash |
| Anthropic, xAI, Groq, Mistral, Z.ai, Ollama, others | Not yet | Pick any model yourself |

Auto is offered only where a pairing has been measured doing everyday and difficult jobs well — Jeeves's name is on every result. Everywhere else, the model list says so in one line.

## Everyday commands

| Type | What it does |
|---|---|
| `/model` | Choose a service and a model (or Auto), and set your daily limit |
| `/keys` | Add, replace or remove keys |
| `/undo` | Put the project folder back to before your last request |
| `/clear` | Start a fresh conversation |
| `/address` | Change how Jeeves addresses you |
| `/verbose` | Show the technical details as well |
| `/help` | See everything in plain English |
| `/exit` | Leave, with your terminal exactly as it was |

Arrow keys and the trackpad scroll the conversation; `Page Up` / `Page Down` jump a screen; `End` returns to the newest. `Ctrl+R` shows the model's reasoning for the last answer.

## Platforms

- **macOS** — fully tried and used every day.
- **Windows and Linux** — every change is built and tested on both automatically; hands-on use on those machines is coming.

## Coming

- Hands-on checks on Windows and Linux.
- Auto for more services, as each is proven.

## Licence

MIT — made by [Tianmu Creations](https://tianmucreations.com).
