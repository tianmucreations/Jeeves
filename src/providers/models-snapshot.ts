// Built-in copy of the models.dev catalogue (MIT licence), trimmed to what Jeeves uses.
// Taken 2026-09-18 by scripts/update-models-snapshot.ts - do not edit by hand.
import type { Catalogue } from './catalogue.js';

export const MODELS_SNAPSHOT: Catalogue = {
 "anthropic": [
  {
   "id": "claude-sonnet-4-6",
   "name": "Claude Sonnet 4.6",
   "released": "2026-02-17",
   "context": 1000000,
   "cost": {
    "input": 3,
    "output": 15,
    "cacheRead": 0.3,
    "cacheWrite": 3.75
   }
  },
  {
   "id": "claude-opus-5",
   "name": "Claude Opus 5",
   "released": "2026-07-24",
   "context": 1000000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  },
  {
   "id": "claude-opus-4-5",
   "name": "Claude Opus 4.5 (latest)",
   "released": "2025-11-24",
   "context": 200000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  },
  {
   "id": "claude-fable-5-1",
   "name": "Claude Fable 5.1",
   "released": "2026-09-01",
   "context": 1000000,
   "cost": {
    "input": 10,
    "output": 50,
    "cacheRead": 0.25,
    "cacheWrite": 12.5
   }
  },
  {
   "id": "claude-opus-4-6",
   "name": "Claude Opus 4.6",
   "released": "2026-02-04",
   "context": 1000000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  },
  {
   "id": "claude-sonnet-4-5-20250929",
   "name": "Claude Sonnet 4.5",
   "released": "2025-09-29",
   "context": 1000000,
   "cost": {
    "input": 3,
    "output": 15,
    "cacheRead": 0.3,
    "cacheWrite": 3.75
   }
  },
  {
   "id": "claude-opus-4-7",
   "name": "Claude Opus 4.7",
   "released": "2026-04-14",
   "context": 1000000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  },
  {
   "id": "claude-haiku-4-5-20251001",
   "name": "Claude Haiku 4.5",
   "released": "2025-10-15",
   "context": 200000,
   "cost": {
    "input": 1,
    "output": 5,
    "cacheRead": 0.1,
    "cacheWrite": 1.25
   }
  },
  {
   "id": "claude-fable-5",
   "name": "Claude Fable 5",
   "released": "2026-06-07",
   "context": 1000000,
   "cost": {
    "input": 10,
    "output": 50,
    "cacheRead": 1,
    "cacheWrite": 12.5
   }
  },
  {
   "id": "claude-haiku-4-5",
   "name": "Claude Haiku 4.5 (latest)",
   "released": "2025-10-15",
   "context": 200000,
   "cost": {
    "input": 1,
    "output": 5,
    "cacheRead": 0.1,
    "cacheWrite": 1.25
   }
  },
  {
   "id": "claude-sonnet-4-5",
   "name": "Claude Sonnet 4.5 (latest)",
   "released": "2025-09-29",
   "context": 1000000,
   "cost": {
    "input": 3,
    "output": 15,
    "cacheRead": 0.3,
    "cacheWrite": 3.75
   }
  },
  {
   "id": "claude-opus-4-8",
   "name": "Claude Opus 4.8",
   "released": "2026-05-28",
   "context": 1000000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  },
  {
   "id": "claude-sonnet-5",
   "name": "Claude Sonnet 5",
   "released": "2026-06-29",
   "context": 1000000,
   "cost": {
    "input": 2,
    "output": 10,
    "cacheRead": 0.2,
    "cacheWrite": 2.5
   }
  },
  {
   "id": "claude-opus-4-5-20251101",
   "name": "Claude Opus 4.5",
   "released": "2025-11-24",
   "context": 200000,
   "cost": {
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25
   }
  }
 ],
 "openai": [
  {
   "id": "gpt-5-nano",
   "name": "GPT-5 Nano",
   "released": "2025-08-07",
   "context": 400000,
   "cost": {
    "input": 0.05,
    "output": 0.4,
    "cacheRead": 0.005
   }
  },
  {
   "id": "gpt-5-pro",
   "name": "GPT-5 Pro",
   "released": "2025-10-06",
   "context": 400000,
   "cost": {
    "input": 15,
    "output": 120
   }
  },
  {
   "id": "gpt-5.6-sol",
   "name": "GPT-5.6 Sol",
   "released": "2026-07-09",
   "context": 1050000,
   "cost": {
    "input": 4,
    "output": 20,
    "cacheRead": 0.4,
    "cacheWrite": 5
   }
  },
  {
   "id": "gpt-4o-2024-08-06",
   "name": "GPT-4o (2024-08-06)",
   "released": "2024-08-06",
   "context": 128000,
   "cost": {
    "input": 2.5,
    "output": 10,
    "cacheRead": 1.25
   }
  },
  {
   "id": "gpt-6-astra",
   "name": "GPT-6 Astra",
   "released": "2026-09-04",
   "context": 1050000,
   "cost": {
    "input": 10,
    "output": 50,
    "cacheRead": 1,
    "cacheWrite": 12.5
   }
  },
  {
   "id": "gpt-5.2-pro",
   "name": "GPT-5.2 Pro",
   "released": "2025-12-11",
   "context": 400000,
   "cost": {
    "input": 21,
    "output": 168
   }
  },
  {
   "id": "gpt-5.3-codex-spark",
   "name": "GPT-5.3 Codex Spark",
   "released": "2026-02-05",
   "context": 128000,
   "cost": {
    "input": 1.75,
    "output": 14,
    "cacheRead": 0.175
   }
  },
  {
   "id": "gpt-4.1-mini",
   "name": "GPT-4.1 mini",
   "released": "2025-04-14",
   "context": 1047576,
   "cost": {
    "input": 0.4,
    "output": 1.6,
    "cacheRead": 0.1
   }
  },
  {
   "id": "gpt-5.4",
   "name": "GPT-5.4",
   "released": "2026-03-05",
   "context": 1050000,
   "cost": {
    "input": 2.5,
    "output": 15,
    "cacheRead": 0.25
   }
  },
  {
   "id": "gpt-5.1",
   "name": "GPT-5.1",
   "released": "2025-11-13",
   "context": 400000,
   "cost": {
    "input": 1.25,
    "output": 10,
    "cacheRead": 0.125
   }
  },
  {
   "id": "gpt-4o",
   "name": "GPT-4o",
   "released": "2024-05-13",
   "context": 128000,
   "cost": {
    "input": 2.5,
    "output": 10,
    "cacheRead": 1.25
   }
  },
  {
   "id": "gpt-5.6-luna",
   "name": "GPT-5.6 Luna",
   "released": "2026-07-09",
   "context": 1050000,
   "cost": {
    "input": 0.2,
    "output": 1.2,
    "cacheRead": 0.02,
    "cacheWrite": 0.25
   }
  },
  {
   "id": "gpt-5.3-codex",
   "name": "GPT-5.3 Codex",
   "released": "2026-02-05",
   "context": 400000,
   "cost": {
    "input": 1.75,
    "output": 14,
    "cacheRead": 0.175
   }
  },
  {
   "id": "gpt-4o-mini",
   "name": "GPT-4o mini",
   "released": "2024-07-18",
   "context": 128000,
   "cost": {
    "input": 0.15,
    "output": 0.6,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gpt-4.1",
   "name": "GPT-4.1",
   "released": "2025-04-14",
   "context": 1047576,
   "cost": {
    "input": 2,
    "output": 8,
    "cacheRead": 0.5
   }
  },
  {
   "id": "gpt-5.4-nano",
   "name": "GPT-5.4 nano",
   "released": "2026-03-17",
   "context": 400000,
   "cost": {
    "input": 0.2,
    "output": 1.25,
    "cacheRead": 0.02
   }
  },
  {
   "id": "gpt-5.5-pro",
   "name": "GPT-5.5 Pro",
   "released": "2026-04-23",
   "context": 1050000,
   "cost": {
    "input": 30,
    "output": 180
   }
  },
  {
   "id": "gpt-5.4-mini",
   "name": "GPT-5.4 mini",
   "released": "2026-03-17",
   "context": 400000,
   "cost": {
    "input": 0.75,
    "output": 4.5,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gpt-5.6",
   "name": "GPT-5.6",
   "released": "2026-07-09",
   "context": 1050000,
   "cost": {
    "input": 4,
    "output": 20,
    "cacheRead": 0.4,
    "cacheWrite": 5
   }
  },
  {
   "id": "gpt-5-mini",
   "name": "GPT-5 Mini",
   "released": "2025-08-07",
   "context": 400000,
   "cost": {
    "input": 0.25,
    "output": 2,
    "cacheRead": 0.025
   }
  },
  {
   "id": "gpt-5.4-pro",
   "name": "GPT-5.4 Pro",
   "released": "2026-03-05",
   "context": 1050000,
   "cost": {
    "input": 30,
    "output": 180
   }
  },
  {
   "id": "gpt-5.6-terra",
   "name": "GPT-5.6 Terra",
   "released": "2026-07-09",
   "context": 1050000,
   "cost": {
    "input": 2,
    "output": 12,
    "cacheRead": 0.2,
    "cacheWrite": 2.5
   }
  },
  {
   "id": "gpt-5.2",
   "name": "GPT-5.2",
   "released": "2025-12-11",
   "context": 400000,
   "cost": {
    "input": 1.75,
    "output": 14,
    "cacheRead": 0.175
   }
  },
  {
   "id": "gpt-5",
   "name": "GPT-5",
   "released": "2025-08-07",
   "context": 400000,
   "cost": {
    "input": 1.25,
    "output": 10,
    "cacheRead": 0.125
   }
  },
  {
   "id": "o3",
   "name": "o3",
   "released": "2025-04-16",
   "context": 200000,
   "cost": {
    "input": 2,
    "output": 8,
    "cacheRead": 0.5
   }
  },
  {
   "id": "o3-pro",
   "name": "o3-pro",
   "released": "2025-06-10",
   "context": 200000,
   "cost": {
    "input": 20,
    "output": 80
   }
  },
  {
   "id": "gpt-5.5",
   "name": "GPT-5.5",
   "released": "2026-04-23",
   "context": 1050000,
   "cost": {
    "input": 5,
    "output": 30,
    "cacheRead": 0.5
   }
  },
  {
   "id": "gpt-4o-2024-11-20",
   "name": "GPT-4o (2024-11-20)",
   "released": "2024-11-20",
   "context": 128000,
   "cost": {
    "input": 2.5,
    "output": 10,
    "cacheRead": 1.25
   }
  }
 ],
 "google": [
  {
   "id": "gemma-4-26b-a4b-it",
   "name": "Gemma 4 26B A4B IT",
   "released": "2026-04-02",
   "context": 262144
  },
  {
   "id": "gemini-3.1-pro-preview-customtools",
   "name": "Gemini 3.1 Pro Preview Custom Tools",
   "released": "2026-02-19",
   "context": 1048576,
   "cost": {
    "input": 2,
    "output": 12,
    "cacheRead": 0.2
   }
  },
  {
   "id": "gemini-3.1-pro-preview",
   "name": "Gemini 3.1 Pro Preview",
   "released": "2026-02-19",
   "context": 1048576,
   "cost": {
    "input": 2,
    "output": 12,
    "cacheRead": 0.2
   }
  },
  {
   "id": "gemini-2.5-flash-lite",
   "name": "Gemini 2.5 Flash-Lite",
   "released": "2025-06-17",
   "context": 1048576,
   "cost": {
    "input": 0.1,
    "output": 0.4,
    "cacheRead": 0.01
   }
  },
  {
   "id": "gemini-2.5-computer-use-preview-10-2025",
   "name": "Gemini 2.5 Computer Use Preview 10-2025",
   "released": "2025-10-07",
   "context": 131072,
   "cost": {
    "input": 1.25,
    "output": 10
   }
  },
  {
   "id": "gemini-3.6-flash",
   "name": "Gemini 3.6 Flash",
   "released": "2026-07-21",
   "context": 1048576,
   "cost": {
    "input": 0.75,
    "output": 3.75,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gemini-3.1-flash-lite",
   "name": "Gemini 3.1 Flash Lite",
   "released": "2026-05-07",
   "context": 1048576,
   "cost": {
    "input": 0.25,
    "output": 1.5,
    "cacheRead": 0.025
   }
  },
  {
   "id": "gemini-3.5-flash",
   "name": "Gemini 3.5 Flash",
   "released": "2026-05-19",
   "context": 1048576,
   "cost": {
    "input": 1.5,
    "output": 9,
    "cacheRead": 0.15
   }
  },
  {
   "id": "gemini-3.5-flash-lite",
   "name": "Gemini 3.5 Flash Lite",
   "released": "2026-07-21",
   "context": 1048576,
   "cost": {
    "input": 0.3,
    "output": 2.5,
    "cacheRead": 0.03
   }
  },
  {
   "id": "gemini-flash-lite-latest",
   "name": "Gemini Flash-Lite Latest",
   "released": "2026-07-21",
   "context": 1048576,
   "cost": {
    "input": 0.3,
    "output": 2.5,
    "cacheRead": 0.03
   }
  },
  {
   "id": "gemma-4-31b-it",
   "name": "Gemma 4 31B IT",
   "released": "2026-04-02",
   "context": 262144
  },
  {
   "id": "gemini-3-flash-preview",
   "name": "Gemini 3 Flash Preview",
   "released": "2025-12-17",
   "context": 1048576,
   "cost": {
    "input": 0.5,
    "output": 3,
    "cacheRead": 0.05
   }
  },
  {
   "id": "gemini-3.8-flash",
   "name": "Gemini 3.8 Flash",
   "released": "2026-09-02",
   "context": 1048576,
   "cost": {
    "input": 0.75,
    "output": 3.75,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gemini-3.7-flash",
   "name": "Gemini 3.7 Flash",
   "released": "2026-08-13",
   "context": 1048576,
   "cost": {
    "input": 0.75,
    "output": 3.75,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gemini-2.5-pro",
   "name": "Gemini 2.5 Pro",
   "released": "2025-06-17",
   "context": 1048576,
   "cost": {
    "input": 1.25,
    "output": 10,
    "cacheRead": 0.125
   }
  },
  {
   "id": "gemini-flash-latest",
   "name": "Gemini Flash Latest",
   "released": "2026-08-13",
   "context": 1048576,
   "cost": {
    "input": 0.75,
    "output": 3.75,
    "cacheRead": 0.075
   }
  },
  {
   "id": "gemini-2.5-flash",
   "name": "Gemini 2.5 Flash",
   "released": "2025-06-17",
   "context": 1048576,
   "cost": {
    "input": 0.3,
    "output": 2.5,
    "cacheRead": 0.03
   }
  }
 ],
 "xai": [
  {
   "id": "grok-4.3",
   "name": "Grok 4.3",
   "released": "2026-04-17",
   "context": 1000000,
   "cost": {
    "input": 1.25,
    "output": 2.5,
    "cacheRead": 0.2
   }
  },
  {
   "id": "grok-4.20-0309-reasoning",
   "name": "Grok 4.20 (Reasoning)",
   "released": "2026-03-09",
   "context": 1000000,
   "cost": {
    "input": 1.25,
    "output": 2.5,
    "cacheRead": 0.2
   }
  },
  {
   "id": "grok-4.5",
   "name": "Grok 4.5",
   "released": "2026-07-08",
   "context": 500000,
   "cost": {
    "input": 2,
    "output": 6,
    "cacheRead": 0.3
   }
  },
  {
   "id": "grok-build-0.1",
   "name": "Grok Build 0.1",
   "released": "2026-04-16",
   "context": 256000,
   "cost": {
    "input": 1,
    "output": 2,
    "cacheRead": 0.2
   }
  },
  {
   "id": "grok-4.6",
   "name": "Grok 4.6",
   "released": "2026-08-12",
   "context": 500000,
   "cost": {
    "input": 2,
    "output": 6,
    "cacheRead": 0.5
   }
  },
  {
   "id": "grok-4.20-0309-non-reasoning",
   "name": "Grok 4.20 (Non-Reasoning)",
   "released": "2026-03-09",
   "context": 1000000,
   "cost": {
    "input": 1.25,
    "output": 2.5,
    "cacheRead": 0.2
   }
  }
 ],
 "mistral": [
  {
   "id": "pixtral-12b",
   "name": "Pixtral 12B",
   "released": "2024-09-01",
   "context": 128000,
   "cost": {
    "input": 0.15,
    "output": 0.15
   }
  },
  {
   "id": "mistral-small-2506",
   "name": "Mistral Small 3.2",
   "released": "2025-06-20",
   "context": 128000,
   "cost": {
    "input": 0.1,
    "output": 0.3
   }
  },
  {
   "id": "magistral-small",
   "name": "Magistral Small",
   "released": "2025-03-17",
   "context": 128000,
   "cost": {
    "input": 0.5,
    "output": 1.5
   }
  },
  {
   "id": "magistral-medium-latest",
   "name": "Magistral Medium (latest)",
   "released": "2025-03-17",
   "context": 128000,
   "cost": {
    "input": 2,
    "output": 5
   }
  },
  {
   "id": "zai-glm-5-3",
   "name": "GLM-5.3",
   "released": "2026-08-14",
   "context": 1000000,
   "cost": {
    "input": 1.4,
    "output": 4.4,
    "cacheRead": 0.14
   }
  },
  {
   "id": "open-mixtral-8x22b",
   "name": "Mixtral 8x22B",
   "released": "2024-04-17",
   "context": 64000,
   "cost": {
    "input": 2,
    "output": 6
   }
  },
  {
   "id": "open-mixtral-8x7b",
   "name": "Mixtral 8x7B",
   "released": "2023-12-11",
   "context": 32000,
   "cost": {
    "input": 0.7,
    "output": 0.7
   }
  },
  {
   "id": "mistral-medium-latest",
   "name": "Mistral Medium (latest)",
   "released": "2026-04-29",
   "context": 262144,
   "cost": {
    "input": 1.5,
    "output": 7.5
   }
  },
  {
   "id": "mistral-medium-2604",
   "name": "Mistral Medium 3.5",
   "released": "2026-04-29",
   "context": 262144,
   "cost": {
    "input": 1.5,
    "output": 7.5
   }
  },
  {
   "id": "mistral-large-2512",
   "name": "Mistral Large 3",
   "released": "2024-11-01",
   "context": 262144,
   "cost": {
    "input": 0.5,
    "output": 1.5
   }
  },
  {
   "id": "voxtral-small-latest",
   "name": "Voxtral Small (latest)",
   "released": "2025-07-15",
   "context": 32000,
   "cost": {
    "input": 0.1,
    "output": 0.3
   }
  },
  {
   "id": "ministral-8b-latest",
   "name": "Ministral 8B (latest)",
   "released": "2024-10-01",
   "context": 128000,
   "cost": {
    "input": 0.1,
    "output": 0.1
   }
  },
  {
   "id": "mistral-nemo",
   "name": "Mistral Nemo",
   "released": "2024-07-01",
   "context": 128000,
   "cost": {
    "input": 0.15,
    "output": 0.15
   }
  },
  {
   "id": "mistral-small-latest",
   "name": "Mistral Small (latest)",
   "released": "2026-03-16",
   "context": 256000,
   "cost": {
    "input": 0.15,
    "output": 0.6
   }
  },
  {
   "id": "mistral-large-latest",
   "name": "Mistral Large (latest)",
   "released": "2024-11-01",
   "context": 262144,
   "cost": {
    "input": 0.5,
    "output": 1.5
   }
  },
  {
   "id": "mistral-large-2411",
   "name": "Mistral Large 2.1",
   "released": "2024-11-18",
   "context": 131072,
   "cost": {
    "input": 2,
    "output": 6
   }
  },
  {
   "id": "zai-glm-5-2",
   "name": "GLM-5.2",
   "released": "2026-06-13",
   "context": 1000000,
   "cost": {
    "input": 1.4,
    "output": 4.4,
    "cacheRead": 0.14
   }
  },
  {
   "id": "mistral-small-2603",
   "name": "Mistral Small 4",
   "released": "2026-03-16",
   "context": 256000,
   "cost": {
    "input": 0.15,
    "output": 0.6
   }
  },
  {
   "id": "mistral-medium-2505",
   "name": "Mistral Medium 3",
   "released": "2025-05-07",
   "context": 131072,
   "cost": {
    "input": 0.4,
    "output": 2
   }
  },
  {
   "id": "codestral-latest",
   "name": "Codestral (latest)",
   "released": "2024-05-29",
   "context": 256000,
   "cost": {
    "input": 0.3,
    "output": 0.9
   }
  },
  {
   "id": "ministral-3b-latest",
   "name": "Ministral 3B (latest)",
   "released": "2024-10-01",
   "context": 128000,
   "cost": {
    "input": 0.04,
    "output": 0.04
   }
  },
  {
   "id": "mistral-medium-2508",
   "name": "Mistral Medium 3.1",
   "released": "2025-08-12",
   "context": 262144,
   "cost": {
    "input": 0.4,
    "output": 2
   }
  },
  {
   "id": "pixtral-large-latest",
   "name": "Pixtral Large (latest)",
   "released": "2024-11-01",
   "context": 128000,
   "cost": {
    "input": 2,
    "output": 6
   }
  }
 ],
 "groq": [
  {
   "id": "llama-3.1-8b-instant",
   "name": "Llama 3.1 8B",
   "released": "2024-07-23",
   "context": 131072,
   "cost": {
    "input": 0.05,
    "output": 0.08
   }
  },
  {
   "id": "llama-3.3-70b-versatile",
   "name": "Llama 3.3 70B",
   "released": "2024-12-06",
   "context": 131072,
   "cost": {
    "input": 0.59,
    "output": 0.79
   }
  },
  {
   "id": "qwen/qwen3.8-27b",
   "name": "Qwen3.8 27B",
   "released": "2026-08-14",
   "context": 131042,
   "cost": {
    "input": 0.8,
    "output": 4
   }
  },
  {
   "id": "qwen/qwen3.6-27b",
   "name": "Qwen3.6 27B",
   "released": "2026-04-22",
   "context": 131072,
   "cost": {
    "input": 0.6,
    "output": 3,
    "cacheRead": 0.3
   }
  },
  {
   "id": "openai/gpt-oss-20b",
   "name": "GPT OSS 20B",
   "released": "2025-08-05",
   "context": 131072,
   "cost": {
    "input": 0.075,
    "output": 0.3,
    "cacheRead": 0.0375
   }
  },
  {
   "id": "openai/gpt-oss-safeguard-20b",
   "name": "Safety GPT OSS 20B",
   "released": "2025-10-29",
   "context": 131072,
   "cost": {
    "input": 0.075,
    "output": 0.3
   }
  },
  {
   "id": "openai/gpt-oss-120b",
   "name": "GPT OSS 120B",
   "released": "2025-08-05",
   "context": 131072,
   "cost": {
    "input": 0.15,
    "output": 0.6,
    "cacheRead": 0.075
   }
  }
 ]
};
