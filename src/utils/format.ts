import type { AskResult, GatewayErrorInfo } from '../types.js';

export function formatSuccess(result: AskResult): string {
  return `${result.text}\n\n[ai-gateway] provider=${result.provider} model=${result.model} duration=${result.duration}ms id=${result.id}`;
}

export function formatError(error: GatewayErrorInfo): string {
  return `[ai-gateway:error] provider=${error.provider} code=${error.code} message="${error.message}" id=${error.id}`;
}

export function generateId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
