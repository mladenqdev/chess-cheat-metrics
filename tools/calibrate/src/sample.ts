// Samples players per rating band from recent big lichess arenas of one time class.
//   pnpm --filter @ccm/calibrate exec tsx src/sample.ts [--per-band 4] \
//     [--time-class blitz|rapid|bullet] [--bands "1200-1600,..."] [--out data/players.json]
import { getJson, getText } from '@ccm/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { USER_AGENT } from './shared';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const perBand = Number(arg('per-band', '4'));
const timeClass = arg('time-class', 'blitz');
const outPath = arg('out', 'data/players.json');
const BANDS: [number, number][] = arg('bands', '1200-1600,1600-2000,2000-2400,2400-3000')
  .split(',')
  .map((range) => {
    const [min, max] = range.split('-').map(Number);
    return [min!, max!] as [number, number];
  });
const opts = { userAgent: USER_AGENT };

interface ArenaList {
  finished: { id: string; nbPlayers: number; perf?: { key?: string } }[];
}

interface ResultLine {
  username: string;
  rating: number;
}

const arenas = (await getJson<ArenaList>('https://lichess.org/api/tournament', opts)).finished
  .filter((t) => t.perf?.key === timeClass && t.nbPlayers >= 60)
  .map((t) => t.id);
console.log(`sampling from ${arenas.length} finished ${timeClass} arenas: ${arenas.join(', ')}`);

const pools = new Map<string, ResultLine[]>(BANDS.map(([min, max]) => [`${min}-${max}`, []]));
const seen = new Set<string>();

for (const id of arenas) {
  const ndjson = await getText(
    `https://lichess.org/api/tournament/${id}/results?nb=400`,
    opts,
    'application/x-ndjson',
  );
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as ResultLine;
    if (!row.username || !row.rating || seen.has(row.username.toLowerCase())) continue;
    seen.add(row.username.toLowerCase());
    const band = BANDS.find(([min, max]) => row.rating >= min && row.rating < max);
    if (band) pools.get(`${band[0]}-${band[1]}`)!.push(row);
  }
  const enough = BANDS.every(([min, max]) => pools.get(`${min}-${max}`)!.length >= perBand * 3);
  if (enough) break;
}

// arenas rarely have enough 2400+ finishers — top up high bands from the tail
// of the blitz leaderboard (its lowest-rated entries sit closest to 2400)
interface Leaderboard {
  users: { username: string; perfs?: Record<string, { rating?: number } | undefined> }[];
}
for (const [min, max] of BANDS.filter(([lo]) => lo >= 2400)) {
  const pool = pools.get(`${min}-${max}`)!;
  if (pool.length >= perBand * 2) continue;
  const top = await getJson<Leaderboard>(
    `https://lichess.org/api/player/top/200/${timeClass}`,
    opts,
  );
  for (const user of top.users.reverse()) {
    const rating = (user.perfs as Record<string, { rating?: number } | undefined>)?.[timeClass]
      ?.rating;
    if (!rating || rating < min || rating >= max || seen.has(user.username.toLowerCase())) continue;
    seen.add(user.username.toLowerCase());
    pool.push({ username: user.username, rating });
    if (pool.length >= perBand * 3) break;
  }
}

const bands = BANDS.map(([min, max]) => {
  const pool = pools.get(`${min}-${max}`)!;
  // shuffle so we don't just take the arena's top finishers
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  console.log(`band ${min}-${max}: pool ${pool.length}, taking ${Math.min(perBand, pool.length)}`);
  return { min, max, players: pool.slice(0, perBand) };
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), timeClass, bands }, null, 2),
);
console.log(`wrote ${outPath}`);
