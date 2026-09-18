import { generateText } from 'ai';
import { session } from '../state/session.js';
import { getOpenRouterKey, serviceKey } from '../providers/index.js';
import { openrouterChat } from '../tools/web/openrouterChat.js';
import { isDirectService } from '../providers/direct-services.js';
import { modelFactory } from '../providers/direct.js';
import { estimateCost, priceOf } from '../providers/catalogue.js';
import { reportSpend } from './spending.js';

// One question to Auto's expert, on the service in use: OpenRouter, or a company
// connected directly with the person's own key. Costs are reported either way
// (OpenRouter's own figure, or worked out from the price list).

export interface ExpertMessage {
  role: 'system' | 'user';
  content: string;
}

export type ExpertChat = (model: string, messages: ExpertMessage[], maxTokens: number) => Promise<string>;

export const expertChat: ExpertChat = async (model, messages, maxTokens) => {
  const providerId = session.providerId;
  if (providerId === 'openrouter') {
    const key = getOpenRouterKey();
    if (!key) throw new Error('the expert needs an OpenRouter key');
    return (await openrouterChat(key, { model, messages, max_tokens: maxTokens })).text;
  }
  if (isDirectService(providerId)) {
    const key = serviceKey(providerId);
    if (!key) throw new Error('the expert needs a key for this service');
    const result = await generateText({
      model: modelFactory(providerId, key)(model),
      instructions: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined,
      messages: messages.filter((m) => m.role === 'user').map((m) => ({ role: 'user' as const, content: m.content })),
      // Thinking models spend part of the allowance before answering, so it is larger here.
      maxOutputTokens: maxTokens * 4,
      abortSignal: AbortSignal.timeout(120_000),
    });
    reportSpend(estimateCost(priceOf(providerId, model), result.usage), true);
    return result.text.trim();
  }
  throw new Error('no expert is available for this service');
};
