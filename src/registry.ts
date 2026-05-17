import type { ProviderAdapter, ProviderInfo, ProviderName } from './types.js';
import { CodexAdapter } from './adapters/codex.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { OpenRouterAdapter } from './adapters/openrouter.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { CopilotAdapter } from './adapters/copilot.js';

const adapters: Record<ProviderName, ProviderAdapter> = {
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  openrouter: new OpenRouterAdapter(),
  ollama: new OllamaAdapter(),
  copilot: new CopilotAdapter(),
};

export function getAdapter(name: ProviderName): ProviderAdapter {
  return adapters[name];
}

export async function detectAll(): Promise<ProviderInfo[]> {
  return Promise.all(Object.values(adapters).map((a) => a.detect()));
}

export const PROVIDER_NAMES: ProviderName[] = ['codex', 'gemini', 'openrouter', 'ollama', 'copilot'];
