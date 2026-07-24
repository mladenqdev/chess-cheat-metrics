// Samples chess.com players per rating band. chess.com has no arena firehose
// like lichess, so we snowball: seed from the live leaderboard, then always
// expand the lowest-rated seen player (walking the rating ladder downward),
// harvesting each game's opponents (username + rating + time class). Low bands
// (few very-low active rated players) may stay thin, which is fine for v1.
//   pnpm --filter @ccm/calibrate exec tsx src/sample-chesscom.ts \
//     [--per-band 30] [--time-class rapid] [--max-seeds 400] [--out data/players-chesscom-rapid-full.json]
import { getJson, type TimeClass } from '@ccm/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { USER_AGENT } from './shared';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const perBand = Number(arg('per-band', '30'));
const timeClass = arg('time-class', 'rapid') as TimeClass;
const maxSeeds = Number(arg('max-seeds', '400'));
const outPath = arg('out', `data/players-chesscom-${timeClass}-full.json`);
const opts = { userAgent: USER_AGENT };

const BANDS: [number, number][] = [
  [400, 800],
  [800, 1200],
  [1200, 1600],
  [1600, 2000],
  [2000, 2400],
  [2400, 3000],
];
const key = (r: number) => BANDS.find(([a, b]) => r >= a && r < b);
const pools = new Map<string, { username: string; rating: number }[]>(
  BANDS.map(([a, b]) => [`${a}-${b}`, []]),
);
const seen = new Set<string>();
const queue: { u: string; r: number }[] = [];

interface Leaderboards {
  live_rapid?: { username: string; score: number }[];
  live_blitz?: { username: string; score: number }[];
}
interface Archives {
  archives: string[];
}
interface ChesscomGame {
  time_class: string;
  rated: boolean;
  white: { username: string; rating: number };
  black: { username: string; rating: number };
}

const lb = await getJson<Leaderboards>('https://api.chess.com/pub/leaderboards', opts);
const lbList = (timeClass === 'rapid' ? lb.live_rapid : lb.live_blitz) ?? [];
for (const p of lbList) {
  if (p.username && !seen.has(p.username.toLowerCase())) {
    seen.add(p.username.toLowerCase());
    queue.push({ u: p.username, r: p.score });
  }
}
console.log(`seeded ${queue.length} leaderboard players; snowballing ${timeClass}, target ${perBand}/band`);

const bandsFull = () => BANDS.every(([a, b]) => pools.get(`${a}-${b}`)!.length >= perBand);

let processed = 0;
while (queue.length > 0 && processed < maxSeeds && !bandsFull()) {
  // target the least-filled band and expand the queued seed nearest its center,
  // so coverage spreads to empty bands instead of diving to one extreme
  const needy = BANDS.map(([a, b]) => ({ a, b, n: pools.get(`${a}-${b}`)!.length }))
    .filter((x) => x.n < perBand)
    .sort((x, y) => x.n - y.n);
  const center = needy.length > 0 ? (needy[0]!.a + needy[0]!.b) / 2 : 1600;
  queue.sort((a, b) => Math.abs(a.r - center) - Math.abs(b.r - center));
  const seed = queue.shift()!;
  processed++;
  try {
    const { archives } = await getJson<Archives>(
      `https://api.chess.com/pub/player/${seed.u.toLowerCase()}/games/archives`,
      opts,
    );
    for (const monthUrl of archives.slice(-2)) {
      const { games } = await getJson<{ games: ChesscomGame[] }>(monthUrl, opts);
      for (const g of games ?? []) {
        if (g.time_class !== timeClass || !g.rated) continue;
        for (const side of [g.white, g.black]) {
          const u = side?.username;
          const r = side?.rating;
          if (!u || !r || seen.has(u.toLowerCase())) continue;
          seen.add(u.toLowerCase());
          const band = key(r);
          if (band) {
            const pool = pools.get(`${band[0]}-${band[1]}`)!;
            if (pool.length < perBand * 3) pool.push({ username: u, rating: r });
          }
          queue.push({ u, r });
        }
      }
    }
  } catch (err) {
    console.error(`${seed.u}: ${err instanceof Error ? err.message : err}`);
  }
  if (processed % 20 === 0) {
    const cov = BANDS.map(([a, b]) => `${a}:${pools.get(`${a}-${b}`)!.length}`).join(' ');
    console.log(`  seeds ${processed}, seen ${seen.size}, pools ${cov}`);
  }
}

const bands = BANDS.map(([min, max]) => {
  const pool = pools.get(`${min}-${max}`)!;
  for (let i = pool.length - 1; i > 0; i--) {
    const jdx = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[jdx]] = [pool[jdx]!, pool[i]!];
  }
  console.log(`band ${min}-${max}: pool ${pool.length}, taking ${Math.min(perBand, pool.length)}`);
  return { min, max, players: pool.slice(0, perBand) };
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), timeClass, platform: 'chesscom', bands }, null, 2),
);
console.log(`wrote ${outPath} (processed ${processed} seeds)`);
