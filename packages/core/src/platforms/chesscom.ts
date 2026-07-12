import { INITIAL_FEN } from 'chessops/fen';
import { parseComment, parsePgn } from 'chessops/pgn';
import { cached, getJson, SerialQueue, type HttpOpts } from '../http';
import { replaySanMoves } from '../replay';
import type {
  GameResult,
  NormalizedGame,
  NormalizedMove,
  NormalizedProfile,
  TimeClass,
} from '../types';

const BASE = 'https://api.chess.com/pub';

/**
 * chess.com requires serial requests: parallel requests from the same client
 * are answered with 429. All requests in this module share one queue.
 */
const chesscomQueue = new SerialQueue();

// --- raw API shapes (only the fields we consume) ---

interface ChesscomGamePlayer {
  username: string;
  rating: number;
  result: string;
}

export interface ChesscomGame {
  url: string;
  uuid: string;
  pgn?: string;
  time_control: string;
  time_class: string;
  rules: string;
  rated: boolean;
  end_time: number;
  initial_setup?: string;
  accuracies?: { white: number; black: number };
  white: ChesscomGamePlayer;
  black: ChesscomGamePlayer;
}

export interface ChesscomProfileRaw {
  username: string;
  title?: string;
  status: string;
  joined?: number;
}

interface ChesscomModeStats {
  last?: { rating?: number };
  record?: { win?: number; loss?: number; draw?: number };
}

export interface ChesscomStatsRaw {
  chess_bullet?: ChesscomModeStats;
  chess_blitz?: ChesscomModeStats;
  chess_rapid?: ChesscomModeStats;
  chess_daily?: ChesscomModeStats;
}

const TIME_CLASS_MAP: Record<string, TimeClass> = {
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  daily: 'correspondence',
};

const DRAW_RESULT_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function resultOf(raw: ChesscomGame): { result: GameResult; termination: string } {
  if (raw.white.result === 'win') return { result: '1-0', termination: raw.black.result };
  if (raw.black.result === 'win') return { result: '0-1', termination: raw.white.result };
  if (DRAW_RESULT_CODES.has(raw.white.result)) {
    return { result: '1/2-1/2', termination: raw.white.result };
  }
  return { result: '*', termination: raw.white.result };
}

function parseTimeControl(tc: string): NormalizedGame['timeControl'] {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(tc);
  if (!match) return null; // daily format like "1/86400"
  return { initialSec: Number(match[1]), incrementSec: Number(match[2] ?? 0) };
}

/** True for games our replay/analysis pipeline supports. */
export function isSupportedChesscomGame(raw: ChesscomGame): boolean {
  return (
    raw.rules === 'chess' &&
    typeof raw.pgn === 'string' &&
    (raw.initial_setup === undefined || raw.initial_setup === INITIAL_FEN)
  );
}

export function normalizeChesscomGame(raw: ChesscomGame): NormalizedGame {
  const game = parsePgn(raw.pgn ?? '')[0];
  if (!game) throw new Error(`unparseable pgn for game ${raw.url}`);

  // walk the mainline collecting SAN + %clk (seconds) from comments
  const sans: string[] = [];
  const clocksSec: (number | undefined)[] = [];
  let node = game.moves;
  while (node.children.length > 0) {
    const child = node.children[0]!;
    sans.push(child.data.san);
    const clock = child.data.comments
      ?.map((c) => parseComment(c).clock)
      .find((value) => value !== undefined);
    clocksSec.push(clock);
    node = child;
  }

  const moves: NormalizedMove[] = replaySanMoves(sans);
  for (let i = 0; i < moves.length; i++) {
    const clock = clocksSec[i];
    if (clock !== undefined) moves[i]!.clockAfterMs = Math.round(clock * 1000);
  }

  const { result, termination } = resultOf(raw);
  return {
    platform: 'chesscom',
    id: raw.uuid,
    url: raw.url,
    rated: raw.rated,
    timeClass: TIME_CLASS_MAP[raw.time_class] ?? 'correspondence',
    timeControl: parseTimeControl(raw.time_control),
    endedAt: raw.end_time * 1000,
    white: {
      username: raw.white.username,
      rating: raw.white.rating,
      accuracy: raw.accuracies?.white,
    },
    black: {
      username: raw.black.username,
      rating: raw.black.rating,
      accuracy: raw.accuracies?.black,
    },
    result,
    termination,
    eco: game.headers.get('ECO'),
    hasPlatformEvals: false, // chess.com never exposes per-move evals
    moves,
  };
}

export function normalizeChesscomProfile(
  profile: ChesscomProfileRaw,
  stats: ChesscomStatsRaw,
): NormalizedProfile {
  const ratings: NormalizedProfile['ratings'] = {};
  let totalGames = 0;
  let sawRecord = false;
  const modes: [keyof ChesscomStatsRaw, TimeClass][] = [
    ['chess_bullet', 'bullet'],
    ['chess_blitz', 'blitz'],
    ['chess_rapid', 'rapid'],
    ['chess_daily', 'correspondence'],
  ];
  for (const [key, timeClass] of modes) {
    const mode = stats[key];
    if (!mode) continue;
    if (mode.last?.rating !== undefined) ratings[timeClass] = mode.last.rating;
    if (mode.record) {
      sawRecord = true;
      totalGames += (mode.record.win ?? 0) + (mode.record.loss ?? 0) + (mode.record.draw ?? 0);
    }
  }

  const banned = profile.status.startsWith('closed');
  return {
    platform: 'chesscom',
    username: profile.username,
    title: profile.title,
    createdAt: profile.joined !== undefined ? profile.joined * 1000 : undefined,
    totalGames: sawRecord ? totalGames : undefined,
    ratings,
    banned,
    banReason: banned
      ? profile.status === 'closed:fair_play_violations'
        ? 'fair_play'
        : 'other'
      : undefined,
  };
}

export async function fetchChesscomProfile(
  username: string,
  opts: HttpOpts = {},
): Promise<NormalizedProfile> {
  const user = encodeURIComponent(username.toLowerCase());
  const profile = await cached(opts.cache, `chesscom:profile:${user}`, 60 * 60_000, () =>
    chesscomQueue.add(() => getJson<ChesscomProfileRaw>(`${BASE}/player/${user}`, opts)),
  );
  const stats = await cached(opts.cache, `chesscom:stats:${user}`, 60 * 60_000, () =>
    chesscomQueue.add(() => getJson<ChesscomStatsRaw>(`${BASE}/player/${user}/stats`, opts)),
  );
  return normalizeChesscomProfile(profile, stats);
}

export interface FetchChesscomGamesOptions {
  max: number;
  timeClasses?: TimeClass[];
  rated?: boolean;
}

export async function fetchChesscomGames(
  username: string,
  { max, timeClasses, rated = true }: FetchChesscomGamesOptions,
  opts: HttpOpts = {},
): Promise<NormalizedGame[]> {
  const user = encodeURIComponent(username.toLowerCase());
  const { archives } = await cached(opts.cache, `chesscom:archives:${user}`, 60 * 60_000, () =>
    chesscomQueue.add(() =>
      getJson<{ archives: string[] }>(`${BASE}/player/${user}/games/archives`, opts),
    ),
  );

  const collected: NormalizedGame[] = [];
  // walk months newest-first until we have enough games
  for (let i = archives.length - 1; i >= 0 && collected.length < max; i--) {
    const monthUrl = archives[i]!;
    // past months are immutable; only the newest month gets a short TTL
    const ttl = i === archives.length - 1 ? 10 * 60_000 : null;
    const { games } = await cached(opts.cache, `chesscom:month:${monthUrl}`, ttl, () =>
      chesscomQueue.add(() => getJson<{ games: ChesscomGame[] }>(monthUrl, opts)),
    );
    for (const raw of games) {
      if (!isSupportedChesscomGame(raw)) continue;
      if (rated && !raw.rated) continue;
      const timeClass = TIME_CLASS_MAP[raw.time_class] ?? 'correspondence';
      if (timeClasses && !timeClasses.includes(timeClass)) continue;
      collected.push(normalizeChesscomGame(raw));
    }
  }

  return collected.sort((a, b) => b.endedAt - a.endedAt).slice(0, max);
}
