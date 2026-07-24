// Builds a per-PLATFORM, rating-conditioned baseline GRID from calibration
// datapoints and writes it into core. For each platform and time class and each
// rating grid point (every STEP), we compute the mean/std of each metric over
// players within ±WINDOW of that rating, so a player is compared to their actual
// neighborhood on their own platform, not a wide fixed band or the wrong platform.
// compareToCohort() interpolates this grid at the player's exact rating.
//   pnpm --filter @ccm/calibrate exec tsx src/build-baselines.ts [--pilot true] \
//     [--lichess data/metrics-v3.jsonl] \
//     [--chesscom data/metrics-chesscom.jsonl,data/metrics-chesscom-blitz.jsonl] \
//     [--min-eligible 40] [--window 200] [--step 50]
import { mean, stddev } from '@ccm/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlayerDatapoint } from './shared';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const pilot = arg('pilot', 'true') !== 'false';
const minEligible = Number(arg('min-eligible', '40'));
const window = Number(arg('window', '200'));
const step = Number(arg('step', '50'));
const lichessIn = arg('lichess', 'data/metrics-v3.jsonl');
const chesscomIn = arg('chesscom', 'data/metrics-chesscom.jsonl,data/metrics-chesscom-blitz.jsonl');
const excludePath = arg('exclude', 'data/banned.jsonl');
const outPath = fileURLToPath(
  new URL('../../../packages/core/src/metrics/baselines.generated.json', import.meta.url),
);

// usernames the platform banned for cheating, excluded so the "normal" cohort
// is not inflated by cheaters (per platform, since names can collide)
const bannedByPlatform = new Map<string, Set<string>>();
try {
  for (const line of readFileSync(excludePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const { platform, username } = JSON.parse(line) as { platform: string; username: string };
    if (!bannedByPlatform.has(platform)) bannedByPlatform.set(platform, new Set());
    bannedByPlatform.get(platform)!.add(username.toLowerCase());
  }
} catch {
  // no exclude file, keep everyone
}

/** reads one or more comma-separated jsonl files, tolerating missing files and
 * a torn last line (a run may still be appending); drops platform-banned players */
function readRows(paths: string, platform: string): PlayerDatapoint[] {
  const banned = bannedByPlatform.get(platform) ?? new Set<string>();
  return paths
    .split(',')
    .flatMap((p) => {
      try {
        return readFileSync(p.trim(), 'utf8').split('\n');
      } catch {
        return [];
      }
    })
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PlayerDatapoint];
      } catch {
        return [];
      }
    })
    .filter((row) => row.eligible >= minEligible && !banned.has(row.username.toLowerCase()));
}

const metric = (values: (number | null | undefined)[]) => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return { mean: mean(present), std: stddev(present) };
};
/** for metrics some datapoints lack, omit rather than emit a fake zero-std */
const maybeMetric = (values: (number | null | undefined)[]) => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length >= 2 ? { mean: mean(present), std: stddev(present) } : undefined;
};

function gridFor(players: PlayerDatapoint[]) {
  const ratings = players.map((p) => p.rating);
  const lo = Math.floor(Math.min(...ratings) / step) * step;
  const hi = Math.ceil(Math.max(...ratings) / step) * step;
  const points = [];
  for (let r = lo; r <= hi; r += step) {
    const win = players.filter((p) => Math.abs(p.rating - r) <= window);
    if (win.length < 2) continue; // need at least a couple to have a std
    points.push({
      rating: r,
      nPlayers: win.length,
      t1Rate: metric(win.map((p) => p.t1Rate)),
      t2Rate: metric(win.map((p) => p.t2Rate)),
      t3Rate: metric(win.map((p) => p.t3Rate)),
      acpl: metric(win.map((p) => p.acplMean)),
      accuracy: metric(win.map((p) => p.accuracyMean)),
      instantRate: metric(win.map((p) => p.instantRate)),
      thinkCv: metric(win.map((p) => p.thinkCv)),
      accuracyStd: maybeMetric(win.map((p) => p.accuracyStdDev)),
      timeComplexityCorr: maybeMetric(win.map((p) => p.timeComplexityCorr)),
    });
  }
  return points;
}

const inputs: { platform: string; rows: PlayerDatapoint[] }[] = [
  { platform: 'lichess', rows: readRows(lichessIn, 'lichess') },
  { platform: 'chesscom', rows: readRows(chesscomIn, 'chesscom') },
];
const excluded = [...bannedByPlatform.values()].reduce((n, s) => n + s.size, 0);

const grid: Record<string, Record<string, ReturnType<typeof gridFor>>> = {};
let totalPlayers = 0;
for (const { platform, rows } of inputs) {
  if (rows.length === 0) continue;
  const byClass = new Map<string, PlayerDatapoint[]>();
  for (const row of rows) {
    byClass.set(row.timeClass, [...(byClass.get(row.timeClass) ?? []), row]);
  }
  grid[platform] = {};
  for (const [timeClass, players] of byClass) grid[platform][timeClass] = gridFor(players);
  totalPlayers += rows.length;
}

const table = {
  meta: {
    engine: 'stockfish 18 lite wasm single-threaded',
    depth: 12,
    multiPv: 3,
    generatedAt: new Date().toISOString(),
    pilot,
    window,
    step,
  },
  grid,
};

writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n');
for (const [platform, tcs] of Object.entries(grid)) {
  for (const [timeClass, points] of Object.entries(tcs)) {
    const mid = points[Math.floor(points.length / 2)];
    console.log(
      `${platform} ${timeClass}: ${points.length} points ${points[0]?.rating}-${points[points.length - 1]?.rating}` +
        (mid
          ? ` | @${mid.rating} (n=${mid.nPlayers}): t1 ${(mid.t1Rate.mean * 100).toFixed(1)}±${(mid.t1Rate.std * 100).toFixed(1)}% acpl ${mid.acpl.mean.toFixed(0)}`
          : ''),
    );
  }
}
console.log(
  `wrote ${outPath} (pilot=${pilot}, window ±${window}, step ${step}, players ${totalPlayers}, excluded ${excluded} banned)`,
);
