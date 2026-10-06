// Refreshes the copy of the models.dev catalogue built into Jeeves (used only when a
// first launch has no internet). Run before a release:
//   npx tsx scripts/update-models-snapshot.ts
import { writeFileSync } from 'node:fs';
import { trimCatalogue, MODELS_DEV_URL } from '../src/providers/catalogue.js';

const response = await fetch(MODELS_DEV_URL);
if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
const catalogue = trimCatalogue(await response.json());
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL('../src/providers/models-snapshot.ts', import.meta.url),
  `// Built-in copy of the models.dev catalogue (MIT licence), trimmed to what Jeeves uses.\n` +
    `// Taken ${date} by scripts/update-models-snapshot.ts - do not edit by hand.\n` +
    `import type { Catalogue } from './catalogue.js';\n\n` +
    `export const MODELS_SNAPSHOT: Catalogue = ${JSON.stringify(catalogue, null, 1)};\n`
);
console.log(Object.entries(catalogue).map(([id, models]) => `${id}: ${models!.length}`).join(', '));
