#!/usr/bin/env node
"use strict";

// src/adapters/base.ts
var import_child_process = require("child_process");

// src/utils/files.ts
var import_fs = require("fs");
var import_path = require("path");
var MAX_FILE_SIZE = 5 * 1024 * 1024;
var fileCache = /* @__PURE__ */ new Map();
function readFileWithCache(filePath, baseDir) {
  const resolved = (0, import_path.resolve)(baseDir || process.cwd(), filePath);
  try {
    const stats = (0, import_fs.statSync)(resolved);
    if (!stats.isFile()) return `--- File: ${filePath} --- (Not a regular file)`;
    if (stats.size > MAX_FILE_SIZE) {
      return `--- File: ${filePath} --- (Too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }
    const cached = fileCache.get(resolved);
    if (cached && cached.mtime === stats.mtimeMs) return cached.content;
    const content = (0, import_fs.readFileSync)(resolved, "utf-8");
    fileCache.set(resolved, { content, mtime: stats.mtimeMs });
    return content;
  } catch {
    return `--- File: ${filePath} --- (Error reading file)`;
  }
}
function buildFileContext(files, baseDir) {
  return files.map((f) => {
    const content = readFileWithCache(f, baseDir);
    return `--- File: ${f} ---
${content}
--- End: ${f} ---`;
  }).join("\n\n");
}

// src/adapters/base.ts
function buildPrompt(params) {
  let prompt = "";
  if (params.system) prompt += params.system + "\n\n";
  if (params.files?.length) prompt += buildFileContext(params.files) + "\n\n";
  prompt += params.prompt;
  return prompt;
}
var BaseAdapter = class {
};
var GatewayError = class extends Error {
  constructor(code, provider, message, id) {
    super(message);
    this.code = code;
    this.provider = provider;
    this.id = id;
    this.name = "GatewayError";
  }
};
function whichCommand(cmd) {
  return new Promise((resolve2) => {
    const child = (0, import_child_process.spawn)("which", [cmd], { stdio: ["ignore", "pipe", "ignore"] });
    child.on("close", (code) => resolve2(code === 0));
    child.on("error", () => resolve2(false));
  });
}
function spawnCli(cmd, args, input, options) {
  const timeout = options?.timeout ?? 3e5;
  return new Promise((resolve2, reject) => {
    let settled = false;
    const child = (0, import_child_process.spawn)(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...options?.cwd ? { cwd: options.cwd } : {}
    });
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`${cmd} timed out after ${timeout}ms`));
      }
    }, timeout);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        resolve2({ stdout, stderr, code: code ?? 1 });
      }
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        reject(err);
      }
    });
    child.stdin.on("error", () => {
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

// src/utils/format.ts
function formatSuccess(result) {
  return `${result.text}

[ai-gateway] provider=${result.provider} model=${result.model} duration=${result.duration}ms id=${result.id}`;
}
function formatError(error) {
  return `[ai-gateway:error] provider=${error.provider} code=${error.code} message="${error.message}" id=${error.id}`;
}
function generateId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// src/adapters/codex.ts
var DEFAULT_MODEL = "gpt-5.3-codex";
var TIMEOUT = 3e5;
function parseCodexOutput(output) {
  const lines = output.trim().split("\n").filter((l) => l.trim());
  const messages = [];
  let error;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.failed" || event.type === "error") {
        const msg = event.error?.message || event.message || JSON.stringify(event);
        error = typeof msg === "string" && msg.startsWith("{") ? JSON.parse(msg).detail || msg : msg;
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        messages.push(event.item.text);
      }
      if (event.type === "message" && event.content) {
        if (typeof event.content === "string") messages.push(event.content);
        else if (Array.isArray(event.content)) {
          for (const part of event.content) {
            if (part.type === "text" && part.text) messages.push(part.text);
          }
        }
      }
      if (event.type === "output_text" && event.text) messages.push(event.text);
    } catch {
    }
  }
  const text = messages.join("\n");
  if (!text && error) return { text: "", error };
  return { text: text || output };
}
var CodexAdapter = class extends BaseAdapter {
  name = "codex";
  type = "cli";
  async detect() {
    const available = await whichCommand("codex");
    return {
      name: "codex",
      type: "cli",
      available,
      models: [DEFAULT_MODEL, "gpt-5.2"],
      defaultModel: DEFAULT_MODEL,
      hint: available ? void 0 : "Install: npm install -g @openai/codex"
    };
  }
  async execute(params) {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL;
    const start = Date.now();
    const prompt = buildPrompt(params);
    try {
      const { stdout, stderr, code } = await spawnCli(
        "codex",
        ["exec", "-m", model, "--json", "--full-auto"],
        prompt,
        { timeout: TIMEOUT }
      );
      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|too many requests/i.test(stderr)) {
          throw new GatewayError("RATE_LIMITED", "codex", stderr.trim(), id);
        }
        if (/auth|unauthorized|login/i.test(stderr)) {
          throw new GatewayError("AUTH_MISSING", "codex", "Not authenticated. Run: codex login", id);
        }
        throw new GatewayError("EXEC_FAILED", "codex", stderr || `Exit code ${code}`, id);
      }
      const result = parseCodexOutput(stdout);
      if (result.error) {
        throw new GatewayError("EXEC_FAILED", "codex", result.error, id);
      }
      return { text: result.text, provider: "codex", model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = err.message;
      if (/timed out/i.test(msg)) throw new GatewayError("TIMEOUT", "codex", msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError("PROVIDER_UNAVAILABLE", "codex", "Codex CLI not found", id);
      throw new GatewayError("EXEC_FAILED", "codex", msg, id);
    }
  }
};

// src/adapters/gemini.ts
var DEFAULT_MODEL2 = "gemini-2.5-pro";
var TIMEOUT2 = 3e5;
var GeminiAdapter = class extends BaseAdapter {
  name = "gemini";
  type = "cli";
  async detect() {
    const available = await whichCommand("gemini");
    return {
      name: "gemini",
      type: "cli",
      available,
      models: [DEFAULT_MODEL2, "gemini-2.5-flash", "gemini-2.0-flash"],
      defaultModel: DEFAULT_MODEL2,
      hint: available ? void 0 : "Install: npm install -g @google/gemini-cli"
    };
  }
  async execute(params) {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL2;
    const start = Date.now();
    const prompt = buildPrompt(params);
    try {
      const { stdout, stderr, code } = await spawnCli(
        "gemini",
        ["-p=.", "--yolo", "--model", model],
        prompt,
        { timeout: TIMEOUT2 }
      );
      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|quota.?exceeded/i.test(stderr)) {
          throw new GatewayError("RATE_LIMITED", "gemini", stderr.trim(), id);
        }
        if (/auth|unauthorized|login/i.test(stderr)) {
          throw new GatewayError("AUTH_MISSING", "gemini", "Not authenticated. Run: gemini login", id);
        }
        throw new GatewayError("EXEC_FAILED", "gemini", stderr || `Exit code ${code}`, id);
      }
      return { text: stdout.trim(), provider: "gemini", model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = err.message;
      if (/timed out/i.test(msg)) throw new GatewayError("TIMEOUT", "gemini", msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError("PROVIDER_UNAVAILABLE", "gemini", "Gemini CLI not found", id);
      throw new GatewayError("EXEC_FAILED", "gemini", msg, id);
    }
  }
};

// src/adapters/openrouter.ts
var DEFAULT_MODEL3 = "anthropic/claude-sonnet-4";
var API_URL = "https://openrouter.ai/api/v1/chat/completions";
var OpenRouterAdapter = class extends BaseAdapter {
  name = "openrouter";
  type = "api";
  getApiKey() {
    return process.env.OPENROUTER_API_KEY;
  }
  async detect() {
    const key = this.getApiKey();
    return {
      name: "openrouter",
      type: "api",
      available: !!key,
      models: [DEFAULT_MODEL3, "google/gemini-2.5-pro", "openai/gpt-4.1"],
      defaultModel: DEFAULT_MODEL3,
      hint: key ? void 0 : "Set OPENROUTER_API_KEY environment variable"
    };
  }
  async execute(params) {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL3;
    const start = Date.now();
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new GatewayError("AUTH_MISSING", "openrouter", "OPENROUTER_API_KEY not set", id);
    }
    const messages = [];
    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }
    const userParams = { ...params, system: void 0 };
    messages.push({ role: "user", content: buildPrompt(userParams) });
    try {
      const body = { model, messages };
      if (params.temperature !== void 0) body.temperature = params.temperature;
      if (params.max_tokens !== void 0) body.max_tokens = params.max_tokens;
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12e4)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (resp.status === 429) throw new GatewayError("RATE_LIMITED", "openrouter", errText, id);
        if (resp.status === 401 || resp.status === 403) throw new GatewayError("AUTH_MISSING", "openrouter", errText, id);
        throw new GatewayError("EXEC_FAILED", "openrouter", `HTTP ${resp.status}: ${errText}`, id);
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "";
      return { text, provider: "openrouter", model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = err.message;
      if (/abort|timeout/i.test(msg)) throw new GatewayError("TIMEOUT", "openrouter", msg, id);
      throw new GatewayError("EXEC_FAILED", "openrouter", msg, id);
    }
  }
};

// src/adapters/ollama.ts
var DEFAULT_MODEL4 = "llama3.3";
var BASE_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
var OllamaAdapter = class extends BaseAdapter {
  name = "ollama";
  type = "api";
  async detect() {
    try {
      const resp = await fetch(`${BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(3e3)
      });
      if (!resp.ok) {
        return {
          name: "ollama",
          type: "api",
          available: false,
          models: [],
          defaultModel: DEFAULT_MODEL4,
          hint: "Ollama not responding. Install: https://ollama.ai"
        };
      }
      const data = await resp.json();
      const models = data.models?.map((m) => m.name) || [];
      return {
        name: "ollama",
        type: "api",
        available: true,
        models: models.length ? models : [DEFAULT_MODEL4],
        defaultModel: models[0] || DEFAULT_MODEL4
      };
    } catch {
      return {
        name: "ollama",
        type: "api",
        available: false,
        models: [],
        defaultModel: DEFAULT_MODEL4,
        hint: "Ollama not running. Start: ollama serve"
      };
    }
  }
  async execute(params) {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL4;
    const start = Date.now();
    const prompt = buildPrompt(params);
    try {
      const body = {
        model,
        prompt,
        stream: false
      };
      if (params.temperature !== void 0) body.options = { temperature: params.temperature };
      if (params.max_tokens !== void 0) {
        body.options = { ...body.options || {}, num_predict: params.max_tokens };
      }
      const resp = await fetch(`${BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3e5)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (/not found|pull/i.test(errText)) {
          throw new GatewayError("INVALID_MODEL", "ollama", `Model "${model}" not found. Run: ollama pull ${model}`, id);
        }
        throw new GatewayError("EXEC_FAILED", "ollama", `HTTP ${resp.status}: ${errText}`, id);
      }
      const data = await resp.json();
      return { text: data.response || "", provider: "ollama", model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = err.message;
      if (/abort|timeout/i.test(msg)) throw new GatewayError("TIMEOUT", "ollama", msg, id);
      if (/ECONNREFUSED|fetch failed/i.test(msg)) throw new GatewayError("PROVIDER_UNAVAILABLE", "ollama", "Ollama not running", id);
      throw new GatewayError("EXEC_FAILED", "ollama", msg, id);
    }
  }
};

// src/adapters/copilot.ts
var DEFAULT_MODEL5 = "claude-sonnet-4.5";
var TIMEOUT3 = 3e5;
function stripUsageStats(output) {
  const lines = output.split("\n");
  let cutIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (/^Total usage/i.test(trimmed) || /^Total duration/i.test(trimmed) || /^Total code changes/i.test(trimmed) || /^Usage by model/i.test(trimmed) || /^Model:/i.test(trimmed)) {
      cutIndex = i;
    } else if (trimmed !== "") {
      break;
    }
  }
  return lines.slice(0, cutIndex).join("\n").trim();
}
var CopilotAdapter = class extends BaseAdapter {
  name = "copilot";
  type = "cli";
  async detect() {
    const available = await whichCommand("copilot");
    return {
      name: "copilot",
      type: "cli",
      available,
      models: [DEFAULT_MODEL5],
      defaultModel: DEFAULT_MODEL5,
      hint: available ? void 0 : "Install: brew install copilot-cli"
    };
  }
  async execute(params) {
    const id = generateId();
    const model = params.model || DEFAULT_MODEL5;
    const start = Date.now();
    const prompt = buildPrompt(params);
    try {
      const { stdout, stderr, code } = await spawnCli(
        "copilot",
        ["-p", prompt],
        "",
        { timeout: TIMEOUT3 }
      );
      if (code !== 0 && !stdout.trim()) {
        if (/429|rate.?limit|too many requests/i.test(stderr)) {
          throw new GatewayError("RATE_LIMITED", "copilot", stderr.trim(), id);
        }
        if (/auth|unauthorized|login|token/i.test(stderr)) {
          throw new GatewayError("AUTH_MISSING", "copilot", "Not authenticated. Run: copilot (then /login)", id);
        }
        throw new GatewayError("EXEC_FAILED", "copilot", stderr || `Exit code ${code}`, id);
      }
      const text = stripUsageStats(stdout);
      return { text, provider: "copilot", model, duration: Date.now() - start, id };
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const msg = err.message;
      if (/timed out/i.test(msg)) throw new GatewayError("TIMEOUT", "copilot", msg, id);
      if (/ENOENT|not found/i.test(msg)) throw new GatewayError("PROVIDER_UNAVAILABLE", "copilot", "Copilot CLI not found. Install: brew install copilot-cli", id);
      throw new GatewayError("EXEC_FAILED", "copilot", msg, id);
    }
  }
};

// src/registry.ts
var adapters = {
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  openrouter: new OpenRouterAdapter(),
  ollama: new OllamaAdapter(),
  copilot: new CopilotAdapter()
};
function getAdapter(name) {
  return adapters[name];
}
async function detectAll() {
  return Promise.all(Object.values(adapters).map((a) => a.detect()));
}
var PROVIDER_NAMES = ["codex", "gemini", "openrouter", "ollama", "copilot"];

// src/chain-executor.ts
function substituteInput(template, input) {
  return template.replace(/\{\{input\}\}/g, input);
}
async function executeChain(params, onStepComplete) {
  const chainId = generateId();
  const startTime = Date.now();
  const stepResults = [];
  let currentInput = params.initial_input ?? "";
  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    if (!PROVIDER_NAMES.includes(step.provider)) {
      throw new GatewayError(
        "PROVIDER_UNAVAILABLE",
        step.provider,
        `Invalid provider "${step.provider}" at step ${i + 1}`,
        chainId
      );
    }
    const resolvedPrompt = substituteInput(step.prompt, currentInput);
    const askParams = {
      provider: step.provider,
      prompt: resolvedPrompt,
      model: step.model,
      system: step.system,
      files: step.files,
      temperature: step.temperature,
      max_tokens: step.max_tokens
    };
    const adapter = getAdapter(step.provider);
    const result = await adapter.execute(askParams);
    const stepResult = {
      step: i + 1,
      label: step.label,
      provider: result.provider,
      model: result.model,
      text: result.text,
      duration: result.duration,
      id: result.id
    };
    stepResults.push(stepResult);
    currentInput = result.text;
    onStepComplete?.(i + 1, params.steps.length);
  }
  return {
    steps: stepResults,
    total_duration: Date.now() - startTime,
    chain_id: chainId
  };
}

// src/cli.ts
function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}
async function cmdAsk(flags) {
  const provider = flags.provider;
  const prompt = flags.prompt;
  if (!provider || !PROVIDER_NAMES.includes(provider)) {
    console.error(`[ai-gateway:error] Invalid provider "${provider}". Available: ${PROVIDER_NAMES.join(", ")}`);
    process.exit(1);
  }
  if (!prompt?.trim()) {
    console.error("[ai-gateway:error] --prompt is required");
    process.exit(1);
  }
  const params = {
    provider,
    prompt,
    model: flags.model,
    system: flags.system,
    files: flags.files ? flags.files.split(",").map((f) => f.trim()) : void 0,
    temperature: flags.temperature ? parseFloat(flags.temperature) : void 0,
    max_tokens: flags["max-tokens"] ? parseInt(flags["max-tokens"], 10) : void 0
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
      console.error(formatError({ code: "UNKNOWN", provider: params.provider, message: err.message, id }));
    }
    process.exit(1);
  }
}
async function cmdProviders() {
  const providers = await detectAll();
  const lines = providers.map((p) => {
    const status = p.available ? "available" : "unavailable";
    const models = p.models.slice(0, 5).join(", ");
    const hint = p.hint ? ` (${p.hint})` : "";
    return `${p.name}: ${status} | default=${p.defaultModel} | models=[${models}]${hint}`;
  });
  console.log(`[ai-gateway] Provider Status

${lines.join("\n")}`);
}
function formatChainResult(result, returnAll) {
  const lines = [];
  if (returnAll) {
    for (const step of result.steps) {
      const label = step.label ? ` (${step.label})` : "";
      lines.push(`--- Step ${step.step}${label} [${step.provider}/${step.model}] ${step.duration}ms ---`);
      lines.push(step.text);
      lines.push("");
    }
  } else {
    const last = result.steps[result.steps.length - 1];
    lines.push(last.text);
    lines.push("");
  }
  const stepSummary = result.steps.map((s) => {
    const label = s.label ? `(${s.label}) ` : "";
    return `${label}${s.provider}/${s.model} ${s.duration}ms`;
  }).join(" \u2192 ");
  lines.push(
    `[ai-gateway:chain] ${result.steps.length} steps | ${stepSummary} | total=${result.total_duration}ms chain_id=${result.chain_id}`
  );
  return lines.join("\n");
}
async function cmdChain(flags) {
  const jsonStr = flags.json;
  if (!jsonStr) {
    console.error("[ai-gateway:error] --json is required for chain command");
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error("[ai-gateway:error] Invalid JSON for --json");
    process.exit(1);
  }
  const steps = parsed.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    console.error("[ai-gateway:error] steps must be a non-empty array");
    process.exit(1);
  }
  if (steps.length > 10) {
    console.error("[ai-gateway:error] Maximum 10 steps allowed");
    process.exit(1);
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.provider || !PROVIDER_NAMES.includes(step.provider)) {
      console.error(
        `[ai-gateway:error] Step ${i + 1}: invalid provider "${step.provider}". Available: ${PROVIDER_NAMES.join(", ")}`
      );
      process.exit(1);
    }
    if (!step.prompt || typeof step.prompt !== "string" || !step.prompt.trim()) {
      console.error(`[ai-gateway:error] Step ${i + 1}: prompt is required`);
      process.exit(1);
    }
  }
  const chainParams = {
    steps: steps.map((s) => ({
      provider: s.provider,
      prompt: s.prompt,
      model: s.model,
      system: s.system,
      files: s.files,
      temperature: s.temperature,
      max_tokens: s.max_tokens,
      label: s.label
    })),
    initial_input: parsed.initial_input,
    return_all: parsed.return_all
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
      console.error(formatError({ code: "UNKNOWN", provider: "codex", message: err.message, id }));
    }
    process.exit(1);
  }
}
function printHelp() {
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
async function main() {
  const { command, flags } = parseArgs(process.argv);
  switch (command) {
    case "ask":
      await cmdAsk(flags);
      break;
    case "providers":
      await cmdProviders();
      break;
    case "chain":
      await cmdChain(flags);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}. Run "ai-gateway help" for usage.`);
      process.exit(1);
  }
}
main().catch((err) => {
  console.error(`[ai-gateway:fatal] ${err.message}`);
  process.exit(1);
});
