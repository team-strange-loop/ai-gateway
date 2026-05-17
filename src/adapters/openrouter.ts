import { BaseAdapter, GatewayError, buildPrompt } from './base.js';
import type { ProviderInfo, AskParams, AskResult } from '../types.js';
import { generateId } from '../utils/format.js';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterAdapter extends BaseAdapter {
  name = 'openrouter' as const;
  type = 'api' as const;

  private getApiKey(): string | undefined {
    return process.env.OPENROUTER_API_KEY;
  }

  async detect(): Promise<ProviderInfo> {
    const key = this.getApiKey();
    return {
      name: 'openrouter',
      type: 'api',
      available: !!key,
      models: [DEFAULT_MODEL, 'google/gemini-2.5-pro', 'openai/gpt-4.1'],
      defaultModel: DEFAULT_MODEL,
      hint: key ? undefined : 'Set OPENROUTER_API_KEY environment variable',
    };
  }

  async execute(params: AskParams): Promise<AskResult> {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new GatewayError('AUTH_MISSING', 'openrouter', 'OPENROUTER_API_KEY not set', id);
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }
    const userParams = { ...params, system: undefined };
    messages.push({ role: 'user', content: buildPrompt(userParams) });

    try {
      const body: Record<string, unknown> = { model, messages };
      if (params.temperature !== undefined) body.temperature = params.temperature;
      if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;

      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (resp.status === 429) throw new GatewayError('RATE_LIMITED', 'openrouter', errText, id);
        if (resp.status === 401 || resp.status === 403) throw new GatewayError('AUTH_MISSING', 'openrouter', errText, id);
        throw new GatewayError('EXEC_FAILED', 'openrouter', `HTTP ${resp.status}: ${errText}`, id);
      }

      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content || '';
      return { text, provider: 'openrouter', model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = (err as Error).message;
      if (/abort|timeout/i.test(msg)) throw new GatewayError('TIMEOUT', 'openrouter', msg, id);
      throw new GatewayError('EXEC_FAILED', 'openrouter', msg, id);
    }
  }
}
