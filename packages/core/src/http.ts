import type { KvCache } from './types';

export type FetchLike = typeof fetch;

export interface HttpOpts {
  /** injectable for tests; defaults to global fetch (browser and Node 18+) */
  fetchFn?: FetchLike;
  /** sent from Node (tools/calibrate); browsers silently drop the header */
  userAgent?: string;
  cache?: KvCache;
  /** injectable for tests; defaults to real setTimeout sleep */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_USER_AGENT = 'chesscheatdetection.com (mladenqdev@gmail.com)';
const MAX_RETRIES = 2;

export class PlatformApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export class UserNotFoundError extends PlatformApiError {
  constructor(url: string) {
    super('user not found', 404, url);
    this.name = 'UserNotFoundError';
  }
}

/** Runs async tasks strictly one after another (chess.com requires serial requests). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  add<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET with 429 handling: waits Retry-After (default 60s, the lichess guidance)
 * and retries up to MAX_RETRIES times. 404 becomes UserNotFoundError.
 */
export async function getText(url: string, opts: HttpOpts = {}, accept?: string): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleepFn ?? realSleep;
  const headers: Record<string, string> = {
    'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
  };
  if (accept) headers['Accept'] = accept;

  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { headers });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterSec = Number(res.headers.get('Retry-After'));
      await sleep(
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 60_000,
      );
      continue;
    }
    if (res.status === 404) throw new UserNotFoundError(url);
    if (!res.ok) throw new PlatformApiError(`request failed with ${res.status}`, res.status, url);
    return res.text();
  }
}

export async function getJson<T>(url: string, opts: HttpOpts = {}): Promise<T> {
  return JSON.parse(await getText(url, opts, 'application/json')) as T;
}

/** Read-through cache helper. ttlMs null means cache forever. */
export async function cached<T>(
  cache: KvCache | undefined,
  key: string,
  ttlMs: number | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (cache) {
    const hit = await cache.get<T>(key);
    if (hit !== undefined) return hit;
  }
  const value = await fn();
  if (cache) await cache.set(key, value, ttlMs ?? undefined);
  return value;
}
