// Scores labeled accounts (banned vs clean) with the calibrated composite and
// prints the separation. Grow data/labels.jsonl over time:
//   {"platform":"chesscom","username":"dewa_kipas","label":"banned"}
//   pnpm --filter @ccm/calibrate exec tsx src/validate.ts [--labels data/labels.jsonl] [--games 10]
import {
  compareToCohort,
  defaultBaselines,
  fetchChesscomGames,
  fetchLichessGames,
  type Platform,
  type TimeClass,
} from '@ccm/core';
import { readFileSync } from 'node:fs';
import { createNodeEngine } from './nodeEngine';
import { analyzePlayerGames, MemCache, USER_AGENT } from './shared';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

interface LabeledAccount {
  platform: Platform;
  username: string;
  label: 'banned' | 'clean';
  timeClass?: TimeClass;
  rating?: number;
}

const labels = readFileSync(arg('labels', 'data/labels.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as LabeledAccount);
const gamesPerPlayer = Number(arg('games', '10'));

const { session, terminate } = await createNodeEngine();
const cache = new MemCache();
const scored: { account: LabeledAccount; composite: number; eligible: number }[] = [];

try {
  for (const account of labels) {
    const timeClass = account.timeClass ?? 'blitz';
    try {
      const games =
        account.platform === 'lichess'
          ? await fetchLichessGames(
              account.username,
              { max: gamesPerPlayer, timeClasses: [timeClass], rated: true },
              { userAgent: USER_AGENT },
            )
          : await fetchChesscomGames(
              account.username,
              { max: gamesPerPlayer, timeClasses: [timeClass], rated: true },
              { userAgent: USER_AGENT },
            );
      const { perGame, aggregate } = await analyzePlayerGames(
        games,
        account.username,
        session,
        cache,
      );
      const rating =
        account.rating ??
        perGame.map((g) => g.rating).filter((r): r is number => r !== undefined)[0] ??
        0;
      // bypass the product sample gate: validation wants a score regardless
      const comparison = compareToCohort(
        { ...aggregate, sampleOk: true },
        { platform: account.platform, timeClass, rating },
        defaultBaselines,
      );
      const eligible = aggregate.eligible;
      if (!comparison) {
        console.log(`${account.label} ${account.username}: no covering band (rating ${rating})`);
        continue;
      }
      scored.push({ account, composite: comparison.composite, eligible });
      console.log(
        `${account.label} ${account.username}: composite z=${comparison.composite.toFixed(2)} ` +
          `tier=${comparison.tier} eligible=${eligible}`,
      );
    } catch (err) {
      console.error(`${account.username}: FAILED, ${err instanceof Error ? err.message : err}`);
    }
  }
} finally {
  terminate();
}

const banned = scored.filter((s) => s.account.label === 'banned').map((s) => s.composite);
const clean = scored.filter((s) => s.account.label === 'clean').map((s) => s.composite);
if (banned.length && clean.length) {
  // AUC = P(banned score > clean score), pairwise
  let wins = 0;
  for (const b of banned) for (const c of clean) wins += b > c ? 1 : b === c ? 0.5 : 0;
  console.log(
    `AUC=${(wins / (banned.length * clean.length)).toFixed(3)} ` +
      `(banned n=${banned.length}, clean n=${clean.length})`,
  );
}
process.exit(0);
