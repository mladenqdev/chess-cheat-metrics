import { UciEngineSession, type UciTransport } from '@ccm/core';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const requireModule = createRequire(import.meta.url);

interface EmscriptenEngine {
  ccall: (
    name: string,
    returnType: null,
    argTypes: string[],
    args: unknown[],
    opts?: { async?: boolean },
  ) => unknown;
  _isReady?: () => number;
  terminate?: () => void;
}

export interface NodeEngine {
  session: UciEngineSession;
  terminate: () => void;
}

/**
 * Runs the same lite single-threaded Stockfish WASM the website ships, in-process.
 * Calibration MUST use the identical engine/depth as the site — match rates are
 * engine-relative. Note: `print` must be injected before init; assigning it after
 * startup does nothing (emscripten captures stdout at initialization).
 */
export async function createNodeEngine(): Promise<NodeEngine> {
  const pkgDir = dirname(requireModule.resolve('stockfish/package.json'));
  const enginePath = join(pkgDir, 'bin', 'stockfish-18-lite-single.js');
  // emscripten asks for a GENERIC name ("stockfish.wasm") — always hand it the
  // lite-single binary, or it silently loads the multithreaded 107MB wasm and
  // dies on a memory-import LinkError
  const wasmPath = join(pkgDir, 'bin', 'stockfish-18-lite-single.wasm');

  let deliver: (line: string) => void = () => {};
  const config = {
    // this build's glue overrides `print` with one that prefers `listener`
    // and falls back to console.log — listener is the real output hook
    listener: (line: string) => deliver(String(line)),
    print: (line: string) => deliver(String(line)),
    printErr: (line: string) => deliver(String(line)),
    locateFile: (file: string) => (file.endsWith('.wasm') ? wasmPath : enginePath),
  };

  // the emscripten glue NULLS global fetch in Node (to force its fs loading
  // path), which would break every later lichess/chess.com API call — restore it
  const realFetch = globalThis.fetch;
  const init = requireModule(enginePath) as () => (cfg: unknown) => Promise<unknown>;
  const initialized = (await init()(config)) as EmscriptenEngine | undefined;
  globalThis.fetch = realFetch;
  const engine: EmscriptenEngine =
    initialized && typeof initialized.ccall === 'function'
      ? initialized
      : (config as unknown as EmscriptenEngine);

  while (typeof engine._isReady === 'function' && !engine._isReady()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const transport: UciTransport = {
    post: (command) => {
      setImmediate(() => {
        void engine.ccall('command', null, ['string'], [command], {
          async: /^go\b/.test(command),
        });
      });
    },
    listen: (cb) => {
      deliver = cb;
    },
  };

  return {
    session: new UciEngineSession(transport),
    terminate: () => engine.terminate?.(),
  };
}
