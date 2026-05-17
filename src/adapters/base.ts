import { spawn } from 'child_process';
import type { ProviderAdapter, ProviderInfo, ProviderName, ProviderType, AskParams, AskResult, ErrorCode } from '../types.js';
import { buildFileContext } from '../utils/files.js';

export function buildPrompt(params: AskParams): string {
  let prompt = '';
  if (params.system) prompt += params.system + '\n\n';
  if (params.files?.length) prompt += buildFileContext(params.files) + '\n\n';
  prompt += params.prompt;
  return prompt;
}

export abstract class BaseAdapter implements ProviderAdapter {
  abstract name: ProviderName;
  abstract type: ProviderType;
  abstract detect(): Promise<ProviderInfo>;
  abstract execute(params: AskParams): Promise<AskResult>;
}

export class GatewayError extends Error {
  constructor(
    public code: ErrorCode,
    public provider: ProviderName,
    message: string,
    public id: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function whichCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export function spawnCli(
  cmd: string,
  args: string[],
  input: string,
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const timeout = options?.timeout ?? 300_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    });

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`${cmd} timed out after ${timeout}ms`));
      }
    }, timeout);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        resolve({ stdout, stderr, code: code ?? 1 });
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        reject(err);
      }
    });

    child.stdin.on('error', () => {}); // Ignore broken pipe
    child.stdin.write(input);
    child.stdin.end();
  });
}
