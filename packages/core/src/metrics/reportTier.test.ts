import { describe, expect, it } from 'vitest';
import type { NormalizedProfile } from '../types';
import type { PlayerAggregate } from './playerReport';
import { reportTier } from './reportTier';

const profile = (banned: boolean): NormalizedProfile => ({
  platform: 'chesscom',
  username: 'x',
  ratings: {},
  banned,
});

const aggregate = (sampleOk: boolean): PlayerAggregate => ({ sampleOk }) as PlayerAggregate;

describe('reportTier', () => {
  it('platform flag wins over everything', () => {
    expect(reportTier(profile(true), aggregate(false))).toBe('flagged-by-platform');
  });

  it('sample gate comes before any metric talk', () => {
    expect(reportTier(profile(false), aggregate(false))).toBe('insufficient-sample');
  });

  it('sufficient unflagged samples are uncalibrated until phase 6', () => {
    expect(reportTier(profile(false), aggregate(true))).toBe('uncalibrated');
  });
});
