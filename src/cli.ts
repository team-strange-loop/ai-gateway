import type { AskParams, ChainParams, ChainResult, ProviderName } from './types.js';
import { getAdapter, detectAll, PROVIDER_NAMES } from './registry.js';
import { GatewayError } from './adapters/base.js';
import { formatSuccess, formatError, generateId } from './utils/format.js';
import { executeChain } from './chain-executor.js';

// --- Argument parsing ---

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? 'help';
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }

  return { command, flags };
}

// --- Commands ---

async function cmdAsk(flags: Record<string, string>): Promise<void> {
  const provider = flags.provider;
  const prompt = flags.prompt;

  if (!provider || !PROVIDER_NAMES.includes(provider as ProviderName)) {
    console.error(`[ai-gateway:error] Invalid provider "${provider}". Available: ${PROVIDER_NAMES.join(', ')}`);
    process.exit(1);
  }

  if (!prompt?.trim()) {
    console.error('[ai-gateway:error] --prompt is required');
    process.exit(1);
  }

  const params: AskParams = {
    provider: provider as ProviderName,
    prompt,
    model: flags.model,
    system: flags.system,
    files: flags.files ? flags.files.split(',').map((f) => f.trim()) : undefined,
    temperature: flags.temperature ? parseFloat(flags.temperature) : undefined,
    max_tokens: flags['max-tokens'] ? parseInt(flags['max-tokens'], 10) : undefined,
  };

  const adapter = getAdapter(params.provider);
  try {
    const result = await adapter.execute(params);
    console.log(formatSuccess(result));
  } catch (err) {
    if (err instanceof GatewayError) {
      console.error(formatError({ code: err.code, provider: err.provider, message: err.message, id: err.id }));
    } else {
      const id = generateId();
      console.error(formatError({ code: 'UNKNOWN', provider: params.provider, message: (err as Error).message, id }));
    }
    process.exit(1);
  }
}

async function cmdProviders(): Promise<void> {
  const providers = await detectAll();
  const lines = providers.map((p) => {
    const status = p.available ? 'available' : 'unavailable';
    const models = p.models.slice(0, 5).join(', ');
    const hint = p.hint ? ` (${p.hint})` : '';
    return `${p.name}: ${status} | default=${p.defaultModel} | models=[${models}]${hint}`;
  });
  console.log(`[ai-gateway] Provider Status\n\n${lines.join('\n')}`);
}

function formatChainResult(result: ChainResult, returnAll: boolean): string {
  const lines: string[] = [];

  if (returnAll) {
    for (const step of result.steps) {
      const label = step.label ? ` (${step.label})` : '';
      lines.push(`--- Step ${step.step}${label} [${step.provider}/${step.model}] ${step.duration}ms ---`);
      lines.push(step.text);
      lines.push('');
    }
  } else {
    const last = result.steps[result.steps.length - 1];
    lines.push(last.text);
    lines.push('');
  }

  const stepSummary = result.steps
    .map((s) => {
      const label = s.label ? `(${s.label}) ` : '';
      return `${label}${s.provider}/${s.model} ${s.duration}ms`;
    })
    .join(' → ');

  lines.push(
    `[ai-gateway:chain] ${result.steps.length} steps | ${stepSummary} | total=${result.total_duration}ms chain_id=${result.chain_id}`,
  );
  return lines.join('\n');
}

async function cmdChain(flags: Record<string, string>): Promise<void> {
  const jsonStr = flags.json;
  if (!jsonStr) {
    console.error('[ai-gateway:error] --json is required for chain command');
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('[ai-gateway:error] Invalid JSON for --json');
    process.exit(1);
  }

  const steps = parsed.steps as unknown[];
  if (!Array.isArray(steps) || steps.length === 0) {
    console.error('[ai-gateway:error] steps must be a non-empty array');
    process.exit(1);
  }

  if (steps.length > 10) {
    console.error('[ai-gateway:error] Maximum 10 steps allowed');
    process.exit(1);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;
    if (!step.provider || !PROVIDER_NAMES.includes(step.provider as ProviderName)) {
      console.error(
        `[ai-gateway:error] Step ${i + 1}: invalid provider "${step.provider}". Available: ${PROVIDER_NAMES.join(', ')}`,
      );
      process.exit(1);
    }
    if (!step.prompt || typeof step.prompt !== 'string' || !(step.prompt as string).trim()) {
      console.error(`[ai-gateway:error] Step ${i + 1}: prompt is required`);
      process.exit(1);
    }
  }

  const chainParams: ChainParams = {
    steps: (steps as Record<string, unknown>[]).map((s) => ({
      provider: s.provider as ProviderName,
      prompt: s.prompt as string,
      model: s.model as string | undefined,
      system: s.system as string | undefined,
      files: s.files as string[] | undefined,
      temperature: s.temperature as number | undefined,
      max_tokens: s.max_tokens as number | undefined,
      label: s.label as string | undefined,
    })),
    initial_input: parsed.initial_input as string | undefined,
    return_all: parsed.return_all as boolean | undefined,
  };

  try {
    const result = await executeChain(chainParams, (step, total) => {
      console.error(`[ai-gateway:chain] Step ${step}/${total} completed`);
    });
    console.log(formatChainResult(result, !!chainParams.return_all));
  } catch (err) {
    if (err instanceof GatewayError) {
      console.error(formatError({ code: err.code, provider: err.provider, message: err.message, id: err.id }));
    } else {
      const id = generateId();
      console.error(formatError({ code: 'UNKNOWN', provider: 'codex', message: (err as Error).message, id }));
    }
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`ai-gateway - CLI for external LLM providers

Commands:
  ask         Send a prompt to an LLM provider
  providers   List available providers and their status
  chain       Execute a multi-step LLM pipeline
  help        Show this help message

Usage:
  ai-gateway ask --provider <name> --prompt <text> [options]
    --provider   codex|gemini|openrouter|ollama|copilot (required)
    --prompt     The prompt to send (required)
    --model      Model name (optional, uses provider default)
    --system     System prompt (optional)
    --files      Comma-separated file paths for context (optional)
    --temperature  Sampling temperature 0-2 (optional)
    --max-tokens   Maximum tokens in response (optional)

  ai-gateway providers

  ai-gateway chain --json '<json>'
    JSON format: {"steps":[{"provider":"...","prompt":"..."}], "initial_input":"...", "return_all":true}

Examples:
  ai-gateway ask --provider codex --prompt "Explain this code"
  ai-gateway ask --provider gemini --prompt "Review this" --files src/main.ts,src/utils.ts
  ai-gateway providers
  ai-gateway chain --json '{"steps":[{"provider":"gemini","prompt":"Translate: {{input}}"},{"provider":"openrouter","prompt":"Verify: {{input}}"}],"initial_input":"Hello"}'`);
}

// --- Main ---

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  switch (command) {
    case 'ask':
      await cmdAsk(flags);
      break;
    case 'providers':
      await cmdProviders();
      break;
    case 'chain':
      await cmdChain(flags);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}. Run "ai-gateway help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[ai-gateway:fatal] ${(err as Error).message}`);
  process.exit(1);
});
