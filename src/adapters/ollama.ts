import { BaseAdapter, GatewayError, buildPrompt } from './base.js';
import type { ProviderInfo, AskParams, AskResult } from '../types.js';
import { generateId } from '../utils/format.js';

const DEFAULT_MODEL = 'llama3.3';
const BASE_URL = process.env.OLLAMA_HOST || 'http://localhost:11434';

export class OllamaAdapter extends BaseAdapter {
  name = 'ollama' as const;
  type = 'api' as const;

  async detect(): Promise<ProviderInfo> {
    try {
      const resp = await fetch(`${BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) {
        return {
          name: 'ollama',
          type: 'api',
          available: false,
          models: [],
          defaultModel: DEFAULT_MODEL,
          hint: 'Ollama not responding. Install: https://ollama.ai',
        };
      }
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      return {
        name: 'ollama',
        type: 'api',
        available: true,
        models: models.length ? models : [DEFAULT_MODEL],
        defaultModel: models[0] || DEFAULT_MODEL,
      };
    } catch {
      return {
        name: 'ollama',
        type: 'api',
        available: false,
        models: [],
        defaultModel: DEFAULT_MODEL,
        hint: 'Ollama not running. Start: ollama serve',
      };
    }
  }

  async execute(params: AskParams): Promise<AskResult> {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();

    const prompt = buildPrompt(params);

    try {
      const body: Record<string, unknown> = {
        model,
        prompt,
        stream: false,
      };
      if (params.temperature !== undefined) body.options = { temperature: params.temperature };
      if (params.max_tokens !== undefined) {
        body.options = { ...(body.options as Record<string, unknown> || {}), num_predict: params.max_tokens };
      }

      const resp = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (/not found|pull/i.test(errText)) {
          throw new GatewayError('INVALID_MODEL', 'ollama', `Model "${model}" not found. Run: ollama pull ${model}`, id);
        }
        throw new GatewayError('EXEC_FAILED', 'ollama', `HTTP ${resp.status}: ${errText}`, id);
      }

      const data = (await resp.json()) as { response?: string };
      return { text: data.response || '', provider: 'ollama', model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = (err as Error).message;
      if (/abort|timeout/i.test(msg)) throw new GatewayError('TIMEOUT', 'ollama', msg, id);
      if (/ECONNREFUSED|fetch failed/i.test(msg)) throw new GatewayError('PROVIDER_UNAVAILABLE', 'ollama', 'Ollama not running', id);
      throw new GatewayError('EXEC_FAILED', 'ollama', msg, id);
    }
  }
}
