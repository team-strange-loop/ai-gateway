export type ProviderName = 'codex' | 'gemini' | 'openrouter' | 'ollama' | 'copilot';

export type ProviderType = 'cli' | 'api';

export type ErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'AUTH_MISSING'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INVALID_MODEL'
  | 'EXEC_FAILED'
  | 'UNKNOWN';

export interface ProviderInfo {
  name: ProviderName;
  type: ProviderType;
  available: boolean;
  models: string[];
  defaultModel: string;
  hint?: string;
}

export interface AskParams {
  provider: ProviderName;
  prompt: string;
  model?: string;
  system?: string;
  files?: string[];
  temperature?: number;
  max_tokens?: number;
}

export interface AskResult {
  text: string;
  provider: ProviderName;
  model: string;
  duration: number;
  id: string;
}

export interface GatewayErrorInfo {
  code: ErrorCode;
  provider: ProviderName;
  message: string;
  id: string;
}

export interface ChainStep {
  provider: ProviderName;
  prompt: string; // {{input}} replaced with previous step output
  model?: string;
  system?: string;
  files?: string[];
  temperature?: number;
  max_tokens?: number;
  label?: string;
}

export interface ChainParams {
  steps: ChainStep[];
  initial_input?: string;
  return_all?: boolean;
}

export interface ChainStepResult {
  step: number;
  label?: string;
  provider: ProviderName;
  model: string;
  text: string;
  duration: number;
  id: string;
}

export interface ChainResult {
  steps: ChainStepResult[];
  total_duration: number;
  chain_id: string;
}

export interface ProviderAdapter {
  name: ProviderName;
  type: ProviderType;
  detect(): Promise<ProviderInfo>;
  execute(params: AskParams): Promise<AskResult>;
}
