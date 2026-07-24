import { describe, expect, it } from 'vitest';
import type { PlayerAggregate } from './playerReport';
import {
  cohortAt,
  compareToCohort,
  MIN_BAND_PLAYERS,
  type BaselineTable,
  type RatingGridPoint,
} from './baselines';

function mkPoint(over: Partial<RatingGridPoint> = {}): RatingGridPoint {
  return {
    rating: 1800,
    nPlayers: 30,
    t1Rate: { mean: 0.33, std: 0.06 },
    t2Rate: { mean: 0.5, std: 0.07 },
    t3Rate: { mean: 0.6, std: 0.07 },
    acpl: { mean: 45, std: 12 },
    accuracy: { mean: 82, std: 6 },
    instantRate: { mean: 0.1, std: 0.08 },
    thinkCv: { mean: 0.8, std: 0.25 },
    accuracyStd: { mean: 8, std: 3 },
    timeComplexityCorr: { mean: -0.25, std: 0.12 },
    ...over,
  };
}

const meta = {
  engine: 'test',
  depth: 12,
  multiPv: 3,
  generatedAt: '2026-07-12',
  pilot: false,
  window: 200,
  step: 50,
};

/** a lichess-blitz-only table from the given grid points */
const tableOf = (...points: RatingGridPoint[]): BaselineTable => ({
  meta,
  grid: { lichess: { blitz: points } },
});

// single grid point → a constant baseline at any rating (keeps the scoring tests simple)
const table = tableOf(mkPoint());
const player = { platform: 'lichess' as const, timeClass: 'blitz' as const, rating: 1700 };

function aggregate(over: Partial<PlayerAggregate>): PlayerAggregate {
  const rate = (r: number) => ({ successes: 0, n: 200, rate: r, ci: [r, r] as [number, number] });
  return {
    games: 10,
    eligible: 200,
    t1: rate(0.33),
    t2: rate(0.5),
    t3: rate(0.6),
    acpl: { mean: 45, std: 30, n: 180 },
    accuracyMean: { mean: 82, n: 10 },
    timing: {
      n: 180,
      meanMs: 5000,
      medianMs: 4000,
      stdMs: 4000,
      coefficientOfVariation: 0.8,
      instantRate: 0.1,
    },
    sampleOk: true,
    ...over,
  };
}

describe('cohortAt', () => {
  const twoPoints = tableOf(
    mkPoint({ rating: 1600, nPlayers: 40, t1Rate: { mean: 0.3, std: 0.06 } }),
    mkPoint({ rating: 1800, nPlayers: 60, t1Rate: { mean: 0.36, std: 0.06 } }),
  );

  it('interpolates metrics and count between grid points at the exact rating', () => {
    const cohort = cohortAt(twoPoints, 'lichess', 'blitz', 1700)!; // midpoint
    expect(cohort.t1Rate.mean).toBeCloseTo(0.33);
    expect(cohort.nPlayers).toBe(50);
    // the reported neighborhood is centered on the player, ±window
    expect(cohort.minRating).toBe(1500);
    expect(cohort.maxRating).toBe(1900);
  });

  it('clamps to the nearest endpoint outside the measured range', () => {
    expect(cohortAt(twoPoints, 'lichess', 'blitz', 3000)!.t1Rate.mean).toBeCloseTo(0.36);
    expect(cohortAt(twoPoints, 'lichess', 'blitz', 100)!.t1Rate.mean).toBeCloseTo(0.3);
  });

  it('returns undefined for a time class or platform with no grid', () => {
    expect(cohortAt(table, 'lichess', 'rapid', 1700)).toBeUndefined();
    expect(cohortAt(table, 'chesscom', 'blitz', 1700)).toBeUndefined();
  });
});

describe('compareToCohort', () => {
  it('scores a perfectly average player as normal with composite near 0', () => {
    const comparison = compareToCohort(aggregate({}), player, table);
    expect(comparison).toBeDefined();
    expect(comparison!.tier).toBe('normal');
    expect(Math.abs(comparison!.composite)).toBeLessThan(0.5);
    expect(comparison!.provisional).toBe(false);
  });

  it('scores an engine-like profile as extreme', () => {
    const comparison = compareToCohort(
      aggregate({
        t1: { successes: 0, n: 200, rate: 0.58, ci: [0.5, 0.65] },
        acpl: { mean: 12, std: 10, n: 180 },
        accuracyMean: { mean: 96, n: 10 },
      }),
      player,
      table,
    );
    expect(comparison!.composite).toBeGreaterThan(3.5);
    expect(comparison!.tier).toBe('extreme');
  });

  it('scores a mildly elevated profile as unusual', () => {
    const comparison = compareToCohort(
      aggregate({
        t1: { successes: 0, n: 200, rate: 0.47, ci: [0.4, 0.54] },
        acpl: { mean: 22, std: 15, n: 180 },
      }),
      player,
      table,
    );
    expect(comparison!.tier).toBe('unusual');
  });

  it('is undefined for a platform with no grid', () => {
    expect(
      compareToCohort(aggregate({}), { ...player, platform: 'chesscom' }, table),
    ).toBeUndefined();
  });

  it('flags a thin local neighborhood as provisional', () => {
    const thinTable = tableOf(mkPoint({ nPlayers: MIN_BAND_PLAYERS - 1 }));
    const comparison = compareToCohort(aggregate({}), player, thinTable);
    expect(comparison!.provisional).toBe(true);
  });

  it('never lets varied timing subtract suspicion (one-sided timing signals)', () => {
    const varied = compareToCohort(
      aggregate({
        t1: { successes: 0, n: 200, rate: 0.47, ci: [0.4, 0.54] },
        timing: {
          n: 180,
          meanMs: 5000,
          medianMs: 4000,
          stdMs: 12000,
          coefficientOfVariation: 2.4, // wildly varied timing
          instantRate: 0.0,
        },
      }),
      player,
      table,
    );
    const neutral = compareToCohort(
      aggregate({ t1: { successes: 0, n: 200, rate: 0.47, ci: [0.4, 0.54] } }),
      player,
      table,
    );
    expect(varied!.zThinkCv).toBe(0);
    expect(varied!.zInstant).toBe(0);
    expect(varied!.composite).toBeCloseTo(neutral!.composite, 5);
  });

  it('treats robotic consistency as a one-sided amplifier', () => {
    const base = { t1: { successes: 0, n: 200, rate: 0.47, ci: [0.4, 0.54] as [number, number] } };
    const withoutConsistencyAnomaly = compareToCohort(aggregate(base), player, table);
    const withConsistencyAnomaly = compareToCohort(
      aggregate({
        ...base,
        accuracyStd: { value: 1, n: 10 }, // metronomic game-to-game accuracy
      }),
      player,
      table,
    );
    expect(withConsistencyAnomaly!.zConsistency).toBeCloseTo((8 - 1) / 3);
    expect(withConsistencyAnomaly!.composite).toBeGreaterThan(
      withoutConsistencyAnomaly!.composite + 0.4,
    );

    // human-like swings must not exonerate
    const humanlike = compareToCohort(
      aggregate({ ...base, accuracyStd: { value: 15, n: 10 } }),
      player,
      table,
    );
    expect(humanlike!.zConsistency).toBe(0);
  });

  it('does not score time-vs-difficulty correlation (measured non-discriminating)', () => {
    const flatTimer = compareToCohort(
      aggregate({ timeComplexityCorr: { value: 0.4, n: 200 } }),
      player,
      table,
    );
    const neutral = compareToCohort(aggregate({}), player, table);
    expect(flatTimer!.composite).toBeCloseTo(neutral!.composite, 5);
  });

  it('skips metrics whose baseline spread is degenerate', () => {
    const degenerate = tableOf(mkPoint({ acpl: { mean: 45, std: 0 } }));
    const comparison = compareToCohort(
      aggregate({ acpl: { mean: 10, std: 5, n: 100 } }),
      player,
      degenerate,
    );
    // acpl z would be infinite; it must be dropped, not poison the composite
    expect(Number.isFinite(comparison!.composite)).toBe(true);
    expect(comparison!.zAcpl).toBeUndefined();
  });
});
