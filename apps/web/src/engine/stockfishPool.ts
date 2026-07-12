import {
  UciEngineSession,
  type EvalOptions,
  type LocalEngine,
  type PositionEval,
  type UciTransport,
} from '@ccm/core';

/** Served by vite-plugin-static-copy from node_modules/stockfish/bin (see vite.config.ts). */
const ENGINE_URL = '/engine/stockfish-18-lite-single.js';

class WorkerTransport implements UciTransport {
  constructor(private worker: Worker) {}

  post(command: string): void {
    this.worker.postMessage(command);
  }

  listen(callback: (line: string) => void): void {
    this.worker.addEventListener('message', (event: MessageEvent) => {
      // engines post one line per message, but split defensively
      for (const line of String(event.data).split('\n')) callback(line);
    });
  }
}

export function defaultPoolSize(): number {
  return Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 2));
}

/**
 * Pool of single-threaded Stockfish WASM workers behind the LocalEngine
 * interface. Each session serializes its own searches; requests are dealt
 * round-robin, so up to `size` positions are analysed concurrently.
 */
export class StockfishPool implements LocalEngine {
  private workers: Worker[] = [];
  private sessions: UciEngineSession[] = [];
  private next = 0;

  constructor(size: number = defaultPoolSize()) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(ENGINE_URL);
      this.workers.push(worker);
      this.sessions.push(new UciEngineSession(new WorkerTransport(worker)));
    }
  }

  get size(): number {
    return this.sessions.length;
  }

  evaluate(fen: string, opts: EvalOptions): Promise<PositionEval> {
    const session = this.sessions[this.next++ % this.sessions.length]!;
    return session.evaluate(fen, opts);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.sessions = [];
  }
}

let shared: StockfishPool | undefined;

/** Lazy shared pool — workers load ~7MB of WASM, so create them only on first use. */
export function getSharedPool(): StockfishPool {
  shared ??= new StockfishPool();
  return shared;
}
