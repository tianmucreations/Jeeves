// Refreshes the copies of the models.dev catalogue built into Jeeves (used when a first launch has no
// internet - as OpenCode ships a built-in copy of the whole list). Run before a release:
//   npx tsx scripts/update-models-snapshot.ts
// Two files: the models of the main companies (with prices), and the names and addresses of every
// other AI company, so the "All providers" list is never empty.
import { writeFileSync } from 'node:fs';
import { trimCatalogue, MODELS_DEV_URL } from '../src/providers/catalogue.js';
import { DIRECT_SERVICES, compatibleServices } from '../src/providers/direct-services.js';

const response = await fetch(MODELS_DEV_URL);
if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
const everything = trimCatalogue(await response.json());
const mainIds = new Set(DIRECT_SERVICES.map((service) => service.id));
const catalogue = Object.fromEntries(Object.entries(everything).filter(([id]) => mainIds.has(id)));
const providers = compatibleServices().map((service) => ({ id: service.id, name: service.label, baseURL: service.baseURL, keyPage: service.keyPage }));
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL('../src/providers/models-snapshot.ts', import.meta.url),
  `// Built-in copy of the models.dev catalogue (MIT licence), trimmed to what Jeeves uses.\n` +
    `// Taken ${date} by scripts/update-models-snapshot.ts - do not edit by hand.\n` +
    `import type { Catalogue } from './catalogue.js';\n\n` +
    `export const MODELS_SNAPSHOT: Catalogue = ${JSON.stringify(catalogue, null, 1)};\n`
);
writeFileSync(
  new URL('../src/providers/providers-snapshot.ts', import.meta.url),
  `// Built-in list of the other AI companies (names and web addresses) from models.dev (MIT licence).\n` +
    `// Taken ${date} by scripts/update-models-snapshot.ts - do not edit by hand.\n` +
    `import type { CompatibleProvider } from './direct-services.js';\n\n` +
    `export const PROVIDERS_SNAPSHOT: CompatibleProvider[] = ${JSON.stringify(providers, null, 1)};\n`
);
console.log(Object.entries(catalogue).map(([id, models]) => `${id}: ${models!.length}`).join(', '), '| other companies:', providers.length);
