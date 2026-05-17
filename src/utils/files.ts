import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface CacheEntry {
  content: string;
  mtime: number;
}

const fileCache = new Map<string, CacheEntry>();

export function readFileWithCache(filePath: string, baseDir?: string): string {
  const resolved = resolve(baseDir || process.cwd(), filePath);
  try {
    const stats = statSync(resolved);
    if (!stats.isFile()) return `--- File: ${filePath} --- (Not a regular file)`;
    if (stats.size > MAX_FILE_SIZE) {
      return `--- File: ${filePath} --- (Too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }

    const cached = fileCache.get(resolved);
    if (cached && cached.mtime === stats.mtimeMs) return cached.content;

    const content = readFileSync(resolved, 'utf-8');
    fileCache.set(resolved, { content, mtime: stats.mtimeMs });
    return content;
  } catch {
    return `--- File: ${filePath} --- (Error reading file)`;
  }
}

export function buildFileContext(files: string[], baseDir?: string): string {
  return files
    .map((f) => {
      const content = readFileWithCache(f, baseDir);
      return `--- File: ${f} ---\n${content}\n--- End: ${f} ---`;
    })
    .join('\n\n');
}
