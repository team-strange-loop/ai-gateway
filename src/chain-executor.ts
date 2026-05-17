import type { ChainParams, ChainResult, ChainStepResult, AskParams } from './types.js';
import { getAdapter, PROVIDER_NAMES } from './registry.js';
import { GatewayError } from './adapters/base.js';
import { generateId } from './utils/format.js';
import type { ProviderName } from './types.js';

function substituteInput(template: string, input: string): string {
  return template.replace(/\{\{input\}\}/g, input);
}

export async function executeChain(
  params: ChainParams,
  onStepComplete?: (step: number, total: number) => void,
): Promise<ChainResult> {
  const chainId = generateId();
  const startTime = Date.now();
  const stepResults: ChainStepResult[] = [];
  let currentInput = params.initial_input ?? '';

  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];

    if (!PROVIDER_NAMES.includes(step.provider as ProviderName)) {
      throw new GatewayError(
        'PROVIDER_UNAVAILABLE',
        step.provider,
        `Invalid provider "${step.provider}" at step ${i + 1}`,
        chainId,
      );
    }

    const resolvedPrompt = substituteInput(step.prompt, currentInput);

    const askParams: AskParams = {
      provider: step.provider,
      prompt: resolvedPrompt,
      model: step.model,
      system: step.system,
      files: step.files,
      temperature: step.temperature,
      max_tokens: step.max_tokens,
    };

    const adapter = getAdapter(step.provider);
    const result = await adapter.execute(askParams);

    const stepResult: ChainStepResult = {
      step: i + 1,
      label: step.label,
      provider: result.provider,
      model: result.model,
      text: result.text,
      duration: result.duration,
      id: result.id,
    };

    stepResults.push(stepResult);
    currentInput = result.text;

    onStepComplete?.(i + 1, params.steps.length);
  }

  return {
    steps: stepResults,
    total_duration: Date.now() - startTime,
    chain_id: chainId,
  };
}
