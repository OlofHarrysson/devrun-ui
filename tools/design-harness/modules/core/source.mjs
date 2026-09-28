import { execFileSync } from 'node:child_process';

export function sourceAt(cwd) {
  try {
    return {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()),
    };
  } catch { return { revision: null, dirty: null }; }
}
