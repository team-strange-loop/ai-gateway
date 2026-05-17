---
name: ai-gateway
description: "This skill should be used when the user asks to 'call external LLM', 'ask codex', 'ask gemini', 'ask copilot', 'use openrouter', 'use ollama', 'external model', 'gateway', 'AI gateway', 'multi-model', 'LLM routing', 'chain LLMs', 'LLM chain', '외부 모델', '게이트웨이', 'LLM 체이닝'"
---

# AI Gateway

Claude Code에서 Bash 도구를 통해 외부 LLM 프로바이더를 호출하기 위한 통합 CLI.

## 사용 가능한 프로바이더

| 프로바이더 | 타입 | 기본 모델 | 감지 방식 |
|-----------|------|----------|----------|
| codex | CLI | gpt-5.3-codex (gpt-5.2) | `which codex` |
| gemini | CLI | gemini-2.5-pro | `which gemini` |
| copilot | CLI | claude-sonnet-4.5 | `which copilot` |
| openrouter | API | anthropic/claude-sonnet-4 | OPENROUTER_API_KEY 환경변수 |
| ollama | API | llama3.3 | localhost:11434 |

## CLI 경로

```
node ${pluginDir}/bridge/ai-gateway.cjs
```

## 명령어

### `ask` - 프로바이더에 프롬프트 전송

```bash
node ${pluginDir}/bridge/ai-gateway.cjs ask \
  --provider codex \
  --prompt "프롬프트 내용" \
  --model "모델명" \
  --system "시스템 프롬프트" \
  --files "file1.ts,file2.ts" \
  --temperature 0.7 \
  --max-tokens 4000
```

필수: `--provider`, `--prompt`
선택: `--model`, `--system`, `--files` (쉼표 구분), `--temperature`, `--max-tokens`

### `providers` - 사용 가능한 프로바이더 목록

```bash
node ${pluginDir}/bridge/ai-gateway.cjs providers
```

파라미터 없음. 모든 프로바이더의 상태를 반환.

### `chain` - 다단계 LLM 파이프라인 실행

```bash
node ${pluginDir}/bridge/ai-gateway.cjs chain \
  --json '{"steps":[{"provider":"gemini","prompt":"번역: {{input}}"},{"provider":"openrouter","prompt":"검증: {{input}}"}],"initial_input":"Hello","return_all":true}'
```

JSON 필드:
- `steps`: `{provider, prompt, model?, system?, files?, temperature?, max_tokens?, label?}` 배열
- `initial_input`: string (선택, 첫 스텝의 `{{input}}` 값)
- `return_all`: boolean (선택, 모든 중간 결과 반환)

## 사용 예시

사용 가능한 프로바이더 확인:
```bash
node ${pluginDir}/bridge/ai-gateway.cjs providers
```

Codex에 코드 리뷰 요청:
```bash
node ${pluginDir}/bridge/ai-gateway.cjs ask \
  --provider codex \
  --system "You are a code reviewer" \
  --prompt "이 함수를 리뷰해주세요: $(cat src/main.ts)"
```

Gemini에 파일 컨텍스트와 함께 요청:
```bash
node ${pluginDir}/bridge/ai-gateway.cjs ask \
  --provider gemini \
  --prompt "이 파일들의 UI 디자인을 리뷰해주세요" \
  --files src/App.tsx,src/components/Header.tsx
```

2개 LLM 체이닝 (번역 후 검증):
```bash
node ${pluginDir}/bridge/ai-gateway.cjs chain \
  --json '{"steps":[{"provider":"gemini","prompt":"한국어로 번역하세요:\n\n{{input}}","label":"번역가"},{"provider":"openrouter","prompt":"이 번역의 정확성을 검증하세요:\n\n{{input}}","label":"검증자"}],"initial_input":"Hello, how are you?","return_all":true}'
```

## 인증

- **Codex**: `codex login` 실행 (OAuth 토큰 자동 상속)
- **Gemini**: `gemini login` 실행 (OAuth 토큰 자동 상속)
- **Copilot**: `copilot` 실행 후 `/login`, 또는 `GH_TOKEN`/`GITHUB_TOKEN` 환경변수 설정
- **OpenRouter**: `OPENROUTER_API_KEY` 환경변수 설정
- **Ollama**: 인증 불필요 (localhost)
