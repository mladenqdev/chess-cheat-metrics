// Builds the baseline table from calibration datapoints and writes it into core.
//   pnpm --filter @ccm/calibrate exec tsx src/build-baselines.ts \
//     [--in data/metrics.jsonl] [--pilot true] [--min-eligible 40]
import { mean, stddev } from '@ccm/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlayerDatapoint } from './shared';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const inPath = arg('in', 'data/metrics.jsonl');
const pilot = arg('pilot', 'true') !== 'false';
const minEligible = Number(arg('min-eligible', '40'));
const outPath = fileURLToPath(
  new URL('../../../packages/core/src/metrics/baselines.generated.json', import.meta.url),
);

const rows = readFileSync(inPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as PlayerDatapoint)
  .filter((row) => row.eligible >= minEligible);

const byBand = new Map<string, PlayerDatapoint[]>();
for (const row of rows) {
  const key = `${row.timeClass}:${row.bandMin}-${row.bandMax}`;
  byBand.set(key, [...(byBand.get(key) ?? []), row]);
}

const metric = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return { mean: mean(present), std: stddev(present) };
};

const bands = [...byBand.entries()].map(([, players]) => {
  const first = players[0]!;
  return {
    timeClass: first.timeClass,
    minRating: first.bandMin,
    maxRating: first.bandMax,
    nPlayers: players.length,
    t1Rate: metric(players.map((p) => p.t1Rate)),
    t2Rate: metric(players.map((p) => p.t2Rate)),
    t3Rate: metric(players.map((p) => p.t3Rate)),
    acpl: metric(players.map((p) => p.acplMean)),
    accuracy: metric(players.map((p) => p.accuracyMean)),
    instantRate: metric(players.map((p) => p.instantRate)),
    thinkCv: metric(players.map((p) => p.thinkCv)),
  };
});

const table = {
  meta: {
    engine: 'stockfish 18 lite wasm single-threaded',
    depth: 12,
    multiPv: 3,
    generatedAt: new Date().toISOString(),
    pilot,
  },
  bands: bands.sort((a, b) => a.minRating - b.minRating),
};

writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n');
for (const band of table.bands) {
  console.log(
    `${band.timeClass} ${band.minRating}-${band.maxRating} (n=${band.nPlayers}): ` +
      `t1 ${(band.t1Rate.mean * 100).toFixed(1)}±${(band.t1Rate.std * 100).toFixed(1)}% ` +
      `acpl ${band.acpl.mean.toFixed(0)}±${band.acpl.std.toFixed(0)} ` +
      `acc ${band.accuracy.mean.toFixed(1)}±${band.accuracy.std.toFixed(1)}`,
  );
}
console.log(`wrote ${outPath} (pilot=${pilot}, players kept: ${rows.length})`);
