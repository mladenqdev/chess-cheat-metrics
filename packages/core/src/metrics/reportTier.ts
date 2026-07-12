import type { NormalizedProfile } from '../types';
import type { PlayerAggregate } from './playerReport';

/**
 * Report headline states. Until baseline calibration lands (phase 6) the
 * only honest verdicts are "the platform itself flagged this account",
 * "not enough evidence", and "here are the numbers, uncalibrated".
 * Calibration will extend this with cohort tiers (normal/unusual/extreme).
 */
export type ReportTier = 'flagged-by-platform' | 'insufficient-sample' | 'uncalibrated';

export function reportTier(profile: NormalizedProfile, aggregate: PlayerAggregate): ReportTier {
  if (profile.banned) return 'flagged-by-platform';
  if (!aggregate.sampleOk) return 'insufficient-sample';
  return 'uncalibrated';
}
