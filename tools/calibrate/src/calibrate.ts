// Analyzes sampled players with the production engine settings and appends
// one player-level datapoint per line (resumable — already-done players skip).
//   pnpm --filter @ccm/calibrate exec tsx src/calibrate.ts [--games 6] \
//     [--in data/players.json] [--out data/metrics.jsonl]
import { fetchLichessGames, type TimeClass } from '@ccm/core';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createNodeEngine } from './nodeEngine';
import {
  analyzePlayerGames,
  MemCache,
  rawDatapoint,
  USER_AGENT,
  type PlayerDatapoint,
} from './shared';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const gamesPerPlayer = Number(arg('games', '6'));
const inPath = arg('in', 'data/players.json');
const outPath = arg('out', 'data/metrics.jsonl');

interface PlayersFile {
  timeClass: TimeClass;
  bands: { min: number; max: number; players: { username: string; rating: number }[] }[];
}

const plan = JSON.parse(readFileSync(inPath, 'utf8')) as PlayersFile;
mkdirSync(dirname(outPath), { recursive: true });

const done = new Set<string>();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as PlayerDatapoint;
    done.add(`${row.timeClass}:${row.username.toLowerCase()}`);
  }
}

const totalPlayers = plan.bands.reduce((n, b) => n + b.players.length, 0);
console.log(
  `calibrating ${totalPlayers} players (${done.size} already done) — ` +
    `${gamesPerPlayer} games each, depth 12 multipv 3`,
);

const { session, terminate } = await createNodeEngine();
const cache = new MemCache();
const startedAt = Date.now();
let processed = 0;

try {
  for (const band of plan.bands) {
    for (const player of band.players) {
      if (done.has(`${plan.timeClass}:${player.username.toLowerCase()}`)) continue;
      const label = `[${band.min}-${band.max}] ${player.username} (${player.rating})`;
      try {
        const games = await fetchLichessGames(
          player.username,
          { max: gamesPerPlayer, timeClasses: [plan.timeClass], rated: true },
          { userAgent: USER_AGENT },
        );
        const t0 = Date.now();
        const { perGame } = await analyzePlayerGames(games, player.username, session, cache);
        const row = rawDatapoint(perGame, {
          username: player.username,
          rating: player.rating,
          timeClass: plan.timeClass,
          bandMin: band.min,
          bandMax: band.max,
        });
        appendFileSync(outPath, JSON.stringify(row) + '\n');
        processed++;
        console.log(
          `${label}: games=${row.games} eligible=${row.eligible} ` +
            `t1=${(row.t1Rate * 100).toFixed(1)}% acpl=${row.acplMean?.toFixed(0) ?? '—'} ` +
            `acc=${row.accuracyMean?.toFixed(1) ?? '—'} in ${Math.round((Date.now() - t0) / 1000)}s`,
        );
      } catch (err) {
        console.error(`${label}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
} finally {
  terminate();
}
console.log(
  `done: ${processed} players in ${Math.round((Date.now() - startedAt) / 60_000)}min → ${outPath}`,
);
process.exit(0);
