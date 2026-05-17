import { BaseAdapter, GatewayError, whichCommand, spawnCli, buildPrompt } from './base.js';
import type { ProviderInfo, AskParams, AskResult } from '../types.js';
import { generateId } from '../utils/format.js';

const DEFAULT_MODEL = 'gemini-2.5-pro';
const TIMEOUT = 300_000;

export class GeminiAdapter extends BaseAdapter {
  name = 'gemini' as const;
  type = 'cli' as const;

  async detect(): Promise<ProviderInfo> {
    const available = await whichCommand('gemini');
    return {
      name: 'gemini',
      type: 'cli',
      available,
      models: [DEFAULT_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'],
      defaultModel: DEFAULT_MODEL,
      hint: available ? undefined : 'Install: npm install -g @google/gemini-cli',
    };
  }

  async execute(params: AskParams): Promise<AskResult> {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();

    const prompt = buildPrompt(params);

    try {
      const { stdout, stderr, code } = await spawnCli(
        'gemini',
        ['-p=.', '--yolo', '--model', model],
        prompt,
        { timeout: TIMEOUT },
      );

      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|quota.?exceeded/i.test(stderr)) {
          throw new GatewayError('RATE_LIMITED', 'gemini', stderr.trim(), id);
        }
        if (/auth|unauthorized|login/i.test(stderr)) {
          throw new GatewayError('AUTH_MISSING', 'gemini', 'Not authenticated. Run: gemini login', id);
        }
        throw new GatewayError('EXEC_FAILED', 'gemini', stderr || `Exit code ${code}`, id);
      }

      return { text: stdout.trim(), provider: 'gemini', model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = (err as Error).message;
      if (/timed out/i.test(msg)) throw new GatewayError('TIMEOUT', 'gemini', msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError('PROVIDER_UNAVAILABLE', 'gemini', 'Gemini CLI not found', id);
      throw new GatewayError('EXEC_FAILED', 'gemini', msg, id);
    }
  }
}
