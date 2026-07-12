import { describe, expect, it } from 'vitest';
import { getText, SerialQueue, UserNotFoundError, type FetchLike } from './http';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('SerialQueue', () => {
  it('runs tasks strictly one after another', async () => {
    const queue = new SerialQueue();
    const order: string[] = [];
    const slow = queue.add(async () => {
      order.push('slow:start');
      await sleep(30);
      order.push('slow:end');
      return 1;
    });
    const fast = queue.add(async () => {
      order.push('fast');
      return 2;
    });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  it('keeps running after a task fails', async () => {
    const queue = new SerialQueue();
    await expect(queue.add(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await queue.add(async () => 'ok')).toBe('ok');
  });
});

describe('getText', () => {
  it('retries after 429 honouring Retry-After', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
        : new Response('payload', { status: 200 });
    };
    const body = await getText('https://example.test/x', {
      fetchFn,
      sleepFn: async (ms) => void slept.push(ms),
    });
    expect(body).toBe('payload');
    expect(calls).toBe(2);
    expect(slept).toEqual([2000]);
  });

  it('throws UserNotFoundError on 404', async () => {
    const fetchFn: FetchLike = async () => new Response('', { status: 404 });
    await expect(getText('https://example.test/x', { fetchFn })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});
