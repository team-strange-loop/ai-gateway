import { BaseAdapter, GatewayError, whichCommand, spawnCli, buildPrompt } from './base.js';
import type { ProviderInfo, AskParams, AskResult } from '../types.js';
import { generateId } from '../utils/format.js';

const DEFAULT_MODEL = 'gpt-5.3-codex';
const TIMEOUT = 300_000;

interface CodexParseResult {
  text: string;
  error?: string;
}

function parseCodexOutput(output: string): CodexParseResult {
  const lines = output.trim().split('\n').filter((l) => l.trim());
  const messages: string[] = [];
  let error: string | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.failed' || event.type === 'error') {
        const msg = event.error?.message || event.message || JSON.stringify(event);
        error = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg).detail || msg : msg;
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
        messages.push(event.item.text);
      }
      if (event.type === 'message' && event.content) {
        if (typeof event.content === 'string') messages.push(event.content);
        else if (Array.isArray(event.content)) {
          for (const part of event.content) {
            if (part.type === 'text' && part.text) messages.push(part.text);
          }
        }
      }
      if (event.type === 'output_text' && event.text) messages.push(event.text);
    } catch {
      // Skip non-JSON lines
    }
  }

  const text = messages.join('\n');
  if (!text && error) return { text: '', error };
  return { text: text || output };
}

export class CodexAdapter extends BaseAdapter {
  name = 'codex' as const;
  type = 'cli' as const;

  async detect(): Promise<ProviderInfo> {
    const available = await whichCommand('codex');
    return {
      name: 'codex',
      type: 'cli',
      available,
      models: [DEFAULT_MODEL, 'gpt-5.2'],
      defaultModel: DEFAULT_MODEL,
      hint: available ? undefined : 'Install: npm install -g @openai/codex',
    };
  }

  async execute(params: AskParams): Promise<AskResult> {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();

    const prompt = buildPrompt(params);

    try {
      const { stdout, stderr, code } = await spawnCli(
        'codex',
        ['exec', '-m', model, '--json', '--full-auto'],
        prompt,
        { timeout: TIMEOUT },
      );

      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|too many requests/i.test(stderr)) {
          throw new GatewayError('RATE_LIMITED', 'codex', stderr.trim(), id);
        }
        if (/auth|unauthorized|login/i.test(stderr)) {
          throw new GatewayError('AUTH_MISSING', 'codex', 'Not authenticated. Run: codex login', id);
        }
        throw new GatewayError('EXEC_FAILED', 'codex', stderr || `Exit code ${code}`, id);
      }

      const result = parseCodexOutput(stdout);
      if (result.error) {
        throw new GatewayError('EXEC_FAILED', 'codex', result.error, id);
      }
      return { text: result.text, provider: 'codex', model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = (err as Error).message;
      if (/timed out/i.test(msg)) throw new GatewayError('TIMEOUT', 'codex', msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError('PROVIDER_UNAVAILABLE', 'codex', 'Codex CLI not found', id);
      throw new GatewayError('EXEC_FAILED', 'codex', msg, id);
    }
  }
}
