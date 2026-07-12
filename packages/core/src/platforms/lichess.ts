import { cached, getJson, getText, type HttpOpts } from '../http';
import { replaySanMoves } from '../replay';
import type {
  GameResult,
  NormalizedGame,
  NormalizedMove,
  NormalizedProfile,
  TimeClass,
} from '../types';

const BASE = 'https://lichess.org';

// --- raw API shapes (only the fields we consume) ---

interface LichessPlayerAnalysis {
  inaccuracy: number;
  mistake: number;
  blunder: number;
  acpl: number;
  accuracy?: number;
}

interface LichessGamePlayer {
  user?: { name: string; id: string };
  rating?: number;
  ratingDiff?: number;
  analysis?: LichessPlayerAnalysis;
}

interface LichessEval {
  eval?: number;
  mate?: number;
  judgment?: { name: string; comment: string };
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  initialFen?: string;
  players: { white: LichessGamePlayer; black: LichessGamePlayer };
  winner?: 'white' | 'black';
  opening?: { eco: string; name: string; ply: number };
  moves: string;
  clocks?: number[];
  analysis?: LichessEval[];
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
}

interface LichessUser {
  id: string;
  username: string;
  title?: string;
  createdAt?: number;
  disabled?: boolean;
  tosViolation?: boolean;
  perfs?: Record<string, { rating?: number; games?: number; prov?: boolean }>;
  count?: { all?: number };
}

const SPEED_TO_TIME_CLASS: Record<string, TimeClass> = {
  ultraBullet: 'ultrabullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  correspondence: 'correspondence',
};

const TIME_CLASS_TO_PERF: Record<TimeClass, string> = {
  ultrabullet: 'ultraBullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  correspondence: 'correspondence',
};

function resultOf(game: LichessGame): GameResult {
  if (game.winner === 'white') return '1-0';
  if (game.winner === 'black') return '0-1';
  if (game.status === 'aborted' || game.status === 'noStart' || game.status === 'created') {
    return '*';
  }
  return '1/2-1/2';
}

function judgmentOf(name: string | undefined): NormalizedMove['judgment'] {
  if (name === 'Inaccuracy') return 'inaccuracy';
  if (name === 'Mistake') return 'mistake';
  if (name === 'Blunder') return 'blunder';
  return undefined;
}

export function normalizeLichessGame(raw: LichessGame): NormalizedGame {
  const sans = raw.moves.length > 0 ? raw.moves.split(' ') : [];
  const moves: NormalizedMove[] = replaySanMoves(sans);

  // clocks are centiseconds remaining after each move; the array can be one
  // entry longer or shorter than the move list, so zip defensively.
  if (raw.clocks) {
    for (let i = 0; i < Math.min(moves.length, raw.clocks.length); i++) {
      moves[i]!.clockAfterMs = raw.clocks[i]! * 10;
    }
  }
  // analysis[i] is the engine eval after move i (white POV)
  if (raw.analysis) {
    for (let i = 0; i < Math.min(moves.length, raw.analysis.length); i++) {
      const entry = raw.analysis[i]!;
      moves[i]!.evalAfter = entry.mate !== undefined ? { mate: entry.mate } : { cp: entry.eval };
      moves[i]!.judgment = judgmentOf(entry.judgment?.name);
    }
  }

  return {
    platform: 'lichess',
    id: raw.id,
    url: `https://lichess.org/${raw.id}`,
    rated: raw.rated,
    timeClass: SPEED_TO_TIME_CLASS[raw.speed] ?? 'correspondence',
    timeControl: raw.clock
      ? { initialSec: raw.clock.initial, incrementSec: raw.clock.increment }
      : null,
    endedAt: raw.lastMoveAt,
    white: {
      username: raw.players.white.user?.name ?? 'Anonymous',
      rating: raw.players.white.rating,
      accuracy: raw.players.white.analysis?.accuracy,
      acpl: raw.players.white.analysis?.acpl,
    },
    black: {
      username: raw.players.black.user?.name ?? 'Anonymous',
      rating: raw.players.black.rating,
      accuracy: raw.players.black.analysis?.accuracy,
      acpl: raw.players.black.analysis?.acpl,
    },
    result: resultOf(raw),
    termination: raw.status,
    eco: raw.opening?.eco,
    openingPly: raw.opening?.ply,
    hasPlatformEvals: raw.analysis !== undefined,
    moves,
  };
}

export function normalizeLichessProfile(raw: LichessUser): NormalizedProfile {
  const ratings: NormalizedProfile['ratings'] = {};
  for (const [perf, data] of Object.entries(raw.perfs ?? {})) {
    const timeClass = SPEED_TO_TIME_CLASS[perf];
    if (timeClass && data.rating !== undefined) ratings[timeClass] = data.rating;
  }
  return {
    platform: 'lichess',
    username: raw.username,
    title: raw.title,
    createdAt: raw.createdAt,
    totalGames: raw.count?.all,
    ratings,
    banned: raw.tosViolation === true,
    banReason: raw.tosViolation === true ? 'tos' : undefined,
    disabled: raw.disabled,
  };
}

export async function fetchLichessProfile(
  username: string,
  opts: HttpOpts = {},
): Promise<NormalizedProfile> {
  const raw = await cached(
    opts.cache,
    `lichess:profile:${username.toLowerCase()}`,
    60 * 60_000,
    () => getJson<LichessUser>(`${BASE}/api/user/${encodeURIComponent(username)}`, opts),
  );
  return normalizeLichessProfile(raw);
}

export interface FetchLichessGamesOptions {
  max: number;
  timeClasses?: TimeClass[];
  rated?: boolean;
  /** only games ending after this epoch ms */
  since?: number;
}

export async function fetchLichessGames(
  username: string,
  { max, timeClasses, rated = true, since }: FetchLichessGamesOptions,
  opts: HttpOpts = {},
): Promise<NormalizedGame[]> {
  const params = new URLSearchParams({
    max: String(max),
    rated: String(rated),
    evals: 'true',
    clocks: 'true',
    accuracy: 'true',
    opening: 'true',
  });
  if (timeClasses?.length) {
    params.set('perfType', timeClasses.map((tc) => TIME_CLASS_TO_PERF[tc]).join(','));
  }
  if (since !== undefined) params.set('since', String(since));

  const url = `${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`;
  const ndjson = await cached(opts.cache, `lichess:games:${url}`, 10 * 60_000, () =>
    getText(url, opts, 'application/x-ndjson'),
  );

  return ndjson
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LichessGame)
    .filter((g) => g.variant === 'standard' && g.initialFen === undefined)
    .map(normalizeLichessGame);
}
