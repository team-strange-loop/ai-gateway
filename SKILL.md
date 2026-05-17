---
name: ai-gateway
description: "This skill should be used when the user asks to 'call external LLM', 'ask codex', 'ask gemini', 'ask copilot', 'use openrouter', 'use ollama', 'external model', 'gateway', 'AI gateway', 'multi-model', 'LLM routing', 'chain LLMs', 'LLM chain'"
---

# AI Gateway

Unified CLI for calling external LLM providers from an agent session.

This skill includes a bundled executable bridge at:

```text
bridge/ai-gateway.cjs
```

Run it from this skill root with `node bridge/ai-gateway.cjs ...`. If the skill
is installed under a larger skills directory, first locate this `SKILL.md` and
use the adjacent `bridge/ai-gateway.cjs` file.

The repository also includes the TypeScript source under `src/` plus
`scripts/build.mjs`, `tsconfig.json`, `package.json`, and `package-lock.json` so
the bridge can be developed, rebuilt, and reinstalled from this skill repo.

## Available Providers

| Provider | Type | Default Model | Detection |
|----------|------|---------------|-----------|
| codex | CLI | gpt-5.3-codex (gpt-5.2) | `which codex` |
| gemini | CLI | gemini-2.5-pro | `which gemini` |
| copilot | CLI | claude-sonnet-4.5 | `which copilot` |
| openrouter | API | anthropic/claude-sonnet-4 | OPENROUTER_API_KEY env |
| ollama | API | llama3.3 | localhost:11434 |

## Requirements

- Node.js 18+
- Provider-specific CLIs or API keys depending on the provider

No package install is required just to run the bundled bridge. For development,
install dependencies and rebuild from the skill root.

## Development

```bash
npm install
npm run build
node bridge/ai-gateway.cjs providers
```

Repository layout:

```text
SKILL.md
src/                  # TypeScript source
scripts/build.mjs     # esbuild bundle step
bridge/ai-gateway.cjs # generated runnable bridge
package.json
package-lock.json
tsconfig.json
```

When editing provider behavior, change `src/`, run `npm run build`, then verify
the generated `bridge/ai-gateway.cjs` with `node bridge/ai-gateway.cjs providers`
and at least one provider-specific smoke test when credentials are available.

## CLI Path

```
node bridge/ai-gateway.cjs
```

## Commands

### `ask` - Send prompt to provider

```bash
node bridge/ai-gateway.cjs ask \
  --provider codex \
  --prompt "Your prompt here" \
  --model "model-name" \
  --system "System prompt" \
  --files "file1.ts,file2.ts" \
  --temperature 0.7 \
  --max-tokens 4000
```

Required: `--provider`, `--prompt`
Optional: `--model`, `--system`, `--files` (comma-separated), `--temperature`, `--max-tokens`

### `providers` - List available providers

```bash
node bridge/ai-gateway.cjs providers
```

No parameters. Returns status of all providers.

### `chain` - Execute multi-step LLM pipeline

```bash
node bridge/ai-gateway.cjs chain \
  --json '{"steps":[{"provider":"gemini","prompt":"Translate: {{input}}"},{"provider":"openrouter","prompt":"Verify: {{input}}"}],"initial_input":"Hello","return_all":true}'
```

JSON fields:
- `steps`: array of `{provider, prompt, model?, system?, files?, temperature?, max_tokens?, label?}`
- `initial_input`: string (optional, first step's `{{input}}` value)
- `return_all`: boolean (optional, return all intermediate results)

## Usage Examples

Check available providers:
```bash
node bridge/ai-gateway.cjs providers
```

Ask Codex for code review:
```bash
node bridge/ai-gateway.cjs ask \
  --provider codex \
  --system "You are a code reviewer" \
  --prompt "Review this function: $(cat src/main.ts)"
```

Ask Gemini with file context:
```bash
node bridge/ai-gateway.cjs ask \
  --provider gemini \
  --prompt "Review the UI design in these files" \
  --files src/App.tsx,src/components/Header.tsx
```

Chain two LLMs (translate then verify):
```bash
node bridge/ai-gateway.cjs chain \
  --json '{"steps":[{"provider":"gemini","prompt":"Translate to Korean:\n\n{{input}}","label":"translator"},{"provider":"openrouter","prompt":"Verify this translation for accuracy:\n\n{{input}}","label":"verifier"}],"initial_input":"Hello, how are you?","return_all":true}'
```

## Authentication

- **Codex**: Run `codex login` (OAuth token inherited)
- **Gemini**: Run `gemini login` (OAuth token inherited)
- **Copilot**: Run `copilot` then `/login`, or set `GH_TOKEN`/`GITHUB_TOKEN` env
- **OpenRouter**: Set `OPENROUTER_API_KEY` environment variable
- **Ollama**: No auth needed (localhost)
