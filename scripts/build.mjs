#!/usr/bin/env node
/**
 * Build script for AI Gateway CLI bundle
 */
import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outfile = 'bridge/ai-gateway.cjs';
const pluginBridge = process.env.AI_GATEWAY_PLUGIN_BRIDGE
  ? resolve(process.env.AI_GATEWAY_PLUGIN_BRIDGE)
  : undefined;

await mkdir('bridge', { recursive: true });

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile,
  banner: { js: '#!/usr/bin/env node' },
  mainFields: ['module', 'main'],
  external: [
    'fs', 'path', 'os', 'util', 'stream', 'events',
    'buffer', 'crypto', 'http', 'https', 'url',
    'child_process', 'assert', 'module', 'net', 'tls',
    'dns', 'readline', 'tty', 'worker_threads',
  ],
});

console.log(`Built ${outfile}`);

if (pluginBridge) {
  await mkdir(dirname(pluginBridge), { recursive: true });
  await copyFile(outfile, pluginBridge);
  console.log(`Copied to ${pluginBridge}`);
}
