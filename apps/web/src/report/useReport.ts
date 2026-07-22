import {
  aggregatePlayerMetrics,
  assessPositions,
  CloudEvalClient,
  compareToCohort,
  computePlayerGameMetrics,
  defaultBaselines,
  evaluateGamePositions,
  fetchChesscomGames,
  fetchChesscomProfile,
  fetchLichessGames,
  fetchLichessProfile,
  reportTier,
  UserNotFoundError,
  type CohortComparison,
  type NormalizedGame,
  type NormalizedProfile,
  type Platform,
  type PlayerAggregate,
  type PlayerGameMetrics,
  type ReportTier,
  type TimeClass,
} from '@ccm/core';
import { useCallback, useRef, useState } from 'react';
import { getSharedPool } from '../engine/stockfishPool';
import { idbCache } from '../lib/idbCache';

const cloudEval = new CloudEvalClient();

/** parses "/u/lichess/thibault" style report permalinks */
export function parseReportPath(
  pathname: string,
): { platform: Platform; username: string } | undefined {
  const match = /^\/u\/(lichess|chesscom)\/([A-Za-z0-9_-]{1,40})$/.exec(pathname);
  if (!match) return undefined;
  return { platform: match[1] as Platform, username: match[2]! };
}

export interface AnalyzedGame {
  game: NormalizedGame;
  metrics?: PlayerGameMetrics;
  avgDepth: number;
  cloudShare: number;
}

export interface ReportData {
  platform: Platform;
  profile: NormalizedProfile;
  tier: ReportTier;
  aggregate: PlayerAggregate;
  comparison?: CohortComparison;
  games: AnalyzedGame[];
  finishedAt: number;
}

/**
 * Picks the cohort to compare against: the time class carrying the most
 * eligible moves, with the player's current rating there (falling back to the
 * mean in-game rating). v1 compares the full aggregate against that band even
 * when time classes are mixed — noted as a refinement candidate.
 */
function cohortComparisonFor(
  profile: NormalizedProfile,
  perPlayer: PlayerGameMetrics[],
  aggregate: PlayerAggregate,
): CohortComparison | undefined {
  if (perPlayer.length === 0) return undefined;
  const eligibleByClass = new Map<TimeClass, number>();
  for (const metrics of perPlayer) {
    eligibleByClass.set(
      metrics.timeClass,
      (eligibleByClass.get(metrics.timeClass) ?? 0) + metrics.eligible,
    );
  }
  const dominant = [...eligibleByClass.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const inGameRatings = perPlayer
    .filter((metrics) => metrics.timeClass === dominant && metrics.rating !== undefined)
    .map((metrics) => metrics.rating!);
  const rating =
    profile.ratings[dominant] ??
    (inGameRatings.length > 0
      ? inGameRatings.reduce((a, b) => a + b, 0) / inGameRatings.length
      : undefined);
  if (rating === undefined) return undefined;
  return compareToCohort(aggregate, { timeClass: dominant, rating }, defaultBaselines);
}

/**
 * The only time controls we analyze: they are what we calibrated, and the
 * methodology holds there. Bullet is too fast and noisy (premoves, flagging,
 * time scrambles), correspondence allows books/engines legally, and classical
 * has no baseline. See ANALYZED_TIME_CLASSES usage in the fetch calls.
 */
const ANALYZED_TIME_CLASSES: TimeClass[] = ['blitz', 'rapid'];

export type ReportState =
  | { phase: 'idle' }
  | { phase: 'fetching'; username: string }
  | {
      phase: 'analyzing';
      profile: NormalizedProfile;
      gameIndex: number;
      gamesTotal: number;
      positionsDone: number;
      positionsTotal: number;
      currentGame: NormalizedGame;
    }
  | { phase: 'done'; data: ReportData }
  | { phase: 'no-games'; profile: NormalizedProfile }
  | { phase: 'error'; message: string };

export function useReport() {
  const [state, setState] = useState<ReportState>({ phase: 'idle' });
  const running = useRef(false);

  const run = useCallback(async (platform: Platform, username: string, maxGames: number) => {
    if (running.current) return;
    running.current = true;
    setState({ phase: 'fetching', username });
    try {
      const opts = { cache: idbCache };
      const [profile, games] =
        platform === 'lichess'
          ? await Promise.all([
              fetchLichessProfile(username, opts),
              fetchLichessGames(
                username,
                { max: maxGames, timeClasses: ANALYZED_TIME_CLASSES },
                opts,
              ),
            ])
          : await Promise.all([
              fetchChesscomProfile(username, opts),
              fetchChesscomGames(
                username,
                { max: maxGames, timeClasses: ANALYZED_TIME_CLASSES },
                opts,
              ),
            ]);

      if (games.length === 0) {
        setState({ phase: 'no-games', profile });
        return;
      }

      const analyzed: AnalyzedGame[] = [];
      const perPlayer: PlayerGameMetrics[] = [];
      for (let i = 0; i < games.length; i++) {
        const game = games[i]!;
        const evals = await evaluateGamePositions(
          game,
          { local: getSharedPool(), cloud: cloudEval, cache: idbCache },
          {
            onProgress: (done, total) =>
              setState({
                phase: 'analyzing',
                profile,
                gameIndex: i,
                gamesTotal: games.length,
                positionsDone: done,
                positionsTotal: total,
                currentGame: game,
              }),
          },
        );
        const assessments = assessPositions(game, evals);
        const metrics = computePlayerGameMetrics(game, evals, assessments, profile.username);
        if (metrics) perPlayer.push(metrics);
        const depths = evals.flatMap((e) => (e ? [e.depth] : []));
        analyzed.push({
          game,
          metrics,
          avgDepth: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
          cloudShare: evals.length
            ? evals.filter((e) => e?.source === 'cloud').length / evals.length
            : 0,
        });
      }

      const aggregate = aggregatePlayerMetrics(perPlayer);
      const comparison = cohortComparisonFor(profile, perPlayer, aggregate);
      setState({
        phase: 'done',
        data: {
          platform,
          profile,
          tier: reportTier(profile, aggregate, comparison),
          aggregate,
          comparison,
          games: analyzed,
          finishedAt: Date.now(),
        },
      });
    } catch (err) {
      setState({
        phase: 'error',
        message:
          err instanceof UserNotFoundError
            ? `No ${platform === 'lichess' ? 'lichess' : 'chess.com'} account named "${username}".`
            : err instanceof Error
              ? err.message
              : String(err),
      });
    } finally {
      running.current = false;
    }
  }, []);

  return { state, run };
}
