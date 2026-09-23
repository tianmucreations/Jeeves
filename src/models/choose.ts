import { session } from '../state/session.js';
import { setRecents, setDefaultModel, setDefaultProvider } from '../platform/config.js';

// Makes a model the one in use and remembers it - the model list and Settings both
// come through here, so a choice is saved the same way wherever it is made.
export function applyModelChoice(provider: string, modelId: string): void {
  session.setProvider(provider);
  session.setModel(modelId);
  setDefaultProvider(provider);
  setDefaultModel(modelId);
  const updatedRecents = [modelId, ...session.recents.filter((id) => id !== modelId)].slice(0, 10);
  session.setRecents(updatedRecents);
  setRecents(updatedRecents);
}
