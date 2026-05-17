import { BaseAdapter, GatewayError, whichCommand, spawnCli, buildPrompt } from './base.js';
import type { ProviderInfo, AskParams, AskResult } from '../types.js';
import { generateId } from '../utils/format.js';

const DEFAULT_MODEL = 'claude-sonnet-4.5';
const TIMEOUT = 300_000;

/**
 * Strip trailing usage statistics from copilot output.
 * Non-interactive mode appends lines like:
 *   Total usage est ...
 *   Total duration (API) ...
 *   Total duration (wall) ...
 *   Total code changes ...
 *   Usage by model ...
 */
function stripUsageStats(output: string): string {
  const lines = output.split('\n');
  let cutIndex = lines.length;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (
      /^Total usage/i.test(trimmed) ||
      /^Total duration/i.test(trimmed) ||
      /^Total code changes/i.test(trimmed) ||
      /^Usage by model/i.test(trimmed) ||
      /^Model:/i.test(trimmed)
    ) {
      cutIndex = i;
    } else if (trimmed !== '') {
      break;
    }
  }

  return lines.slice(0, cutIndex).join('\n').trim();
}

export class CopilotAdapter extends BaseAdapter {
  name = 'copilot' as const;
  type = 'cli' as const;

  async detect(): Promise<ProviderInfo> {
    const available = await whichCommand('copilot');
    return {
      name: 'copilot',
      type: 'cli',
      available,
      models: [DEFAULT_MODEL],
      defaultModel: DEFAULT_MODEL,
      hint: available ? undefined : 'Install: brew install copilot-cli',
    };
  }

  async execute(params: AskParams): Promise<AskResult> {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();

    const prompt = buildPrompt(params);

    try {
      const { stdout, stderr, code } = await spawnCli(
        'copilot',
        ['-p', prompt],
        '',
        { timeout: TIMEOUT },
      );

      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|too many requests/i.test(stderr)) {
          throw new GatewayError('RATE_LIMITED', 'copilot', stderr.trim(), id);
        }
        if (/auth|unauthorized|login|token/i.test(stderr)) {
          throw new GatewayError('AUTH_MISSING', 'copilot', 'Not authenticated. Run: copilot (then /login)', id);
        }
        throw new GatewayError('EXEC_FAILED', 'copilot', stderr || `Exit code ${code}`, id);
      }

      const text = stripUsageStats(stdout);
      return { text, provider: 'copilot', model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = (err as Error).message;
      if (/timed out/i.test(msg)) throw new GatewayError('TIMEOUT', 'copilot', msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError('PROVIDER_UNAVAILABLE', 'copilot', 'Copilot CLI not found. Install: brew install copilot-cli', id);
      throw new GatewayError('EXEC_FAILED', 'copilot', msg, id);
    }
  }
}
