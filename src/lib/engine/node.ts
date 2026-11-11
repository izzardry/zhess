/**
 * Node port: runs the very same engine file the app ships (`public/engine/…`) in-process, for the
 * smoke test and `scripts/selfplay.mjs`. Never imported by app code.
 *
 * The npm package loads an engine with `require(path)()` (stockfish/index.js); the file then exports
 * a factory whose result has `processCommand(cmd)`, a `listener(line)` slot and `terminate()`, and
 * locates its `.wasm` next to `__filename`. This repository is `"type": "module"`, so a plain
 * `require` of the `.js` would treat it as ESM; instead the source is evaluated inside a CommonJS
 * wrapper with the real `__filename` and `__dirname`.
 *
 * Lines are handed on in a microtask: sending a command from inside the engine's print callback
 * re-enters the WASM output buffer and glues lines together (seen as `uciokuciokinfo string …`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLines } from './uci.ts';
import { EngineDriver, type PortHandlers, type UciPort } from './driver.ts';

/** `public/engine/stockfish-19-lite-single.js` of this repository. */
export const DEFAULT_ENGINE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../public/engine/stockfish-19-lite-single.js',
);

interface NodeEngine {
  processCommand(cmd: string): void;
  listener?: (line: string) => void;
  terminate?: () => void;
}

/** True when the engine `.js` and its `.wasm` exist at `file`. */
export function engineFileAvailable(file = DEFAULT_ENGINE_FILE): boolean {
  return existsSync(file) && existsSync(file.replace(/\.js$/, '.wasm'));
}

/** Load the engine file in this process and return its raw factory result. */
function loadEngine(file: string): NodeEngine {
  const src = readFileSync(file, 'utf8');
  const mod: { exports: unknown } = { exports: {} };
  const req = createRequire(file);
  // The engine file is a classic CommonJS script; run it as `require` would.
  const wrapper = new Function('module', 'exports', 'require', '__filename', '__dirname', src);
  wrapper(mod, mod.exports, req, file, dirname(file));
  if (typeof mod.exports !== 'function') throw new Error(`Not a stockfish.js engine: ${file}`);
  return (mod.exports as () => NodeEngine)();
}

/** A UCI port over the in-process engine at `file`. */
export function createNodePort(h: PortHandlers, file = DEFAULT_ENGINE_FILE): UciPort {
  if (!engineFileAvailable(file)) throw new Error(`Engine files not found: ${file}`);
  const engine = loadEngine(file);
  let closed = false;
  engine.listener = (out: string) => {
    queueMicrotask(() => {
      if (closed) return;
      for (const line of splitLines(out)) h.onLine(line);
    });
  };
  return {
    send(cmd: string) {
      if (closed) return;
      engine.processCommand(cmd);
    },
    terminate() {
      if (closed) return;
      closed = true;
      // Not `quit`: in Node the engine answers it with exit(), which sets process.exitCode and throws.
      engine.processCommand('stop');
      engine.terminate?.();
    },
  };
}

/** An engine driver over the in-process engine. */
export function createNodeEngine(opts: { file?: string; rng?: () => number; initTimeoutMs?: number } = {}): EngineDriver {
  return new EngineDriver({
    createPort: (h) => createNodePort(h, opts.file),
    rng: opts.rng,
    initTimeoutMs: opts.initTimeoutMs,
  });
}
