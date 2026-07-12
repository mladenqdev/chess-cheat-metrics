export type Platform = 'lichess' | 'chesscom';

export type TimeClass =
  'ultrabullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface NormalizedMove {
  san: string;
  uci: string;
  /** FEN of the position this move was played in */
  fenBefore: string;
  /** mover's remaining clock after playing this move, in ms */
  clockAfterMs?: number;
  /**
   * Platform engine eval of the position after this move, in white's POV.
   * Only present when the game has platform server analysis (lichess).
   */
  evalAfter?: { cp?: number; mate?: number };
  /** platform judgment of this move, when analysed */
  judgment?: 'inaccuracy' | 'mistake' | 'blunder';
}

export interface NormalizedGamePlayer {
  username: string;
  /**
   * Rating around game time. Semantics differ slightly per platform:
   * lichess reports the pre-game rating, chess.com the post-game rating.
   */
  rating?: number;
  /** platform-computed accuracy % for this game, when available */
  accuracy?: number;
  /** platform-computed average centipawn loss for this game (lichess only) */
  acpl?: number;
}

export interface NormalizedGame {
  platform: Platform;
  id: string;
  url: string;
  rated: boolean;
  timeClass: TimeClass;
  /** null for correspondence/daily games */
  timeControl: { initialSec: number; incrementSec: number } | null;
  /** epoch ms of game end */
  endedAt: number;
  white: NormalizedGamePlayer;
  black: NormalizedGamePlayer;
  result: GameResult;
  /** normalized end reason, e.g. resigned / checkmated / outoftime / agreed */
  termination: string;
  eco?: string;
  /** plies of known opening theory (lichess only; metrics fall back to a fixed cutoff) */
  openingPly?: number;
  /** true when per-move platform evals are attached to `moves` */
  hasPlatformEvals: boolean;
  moves: NormalizedMove[];
}

export interface NormalizedProfile {
  platform: Platform;
  username: string;
  title?: string;
  /** epoch ms of account creation */
  createdAt?: number;
  totalGames?: number;
  ratings: Partial<Record<TimeClass, number>>;
  /** account was closed/marked by the platform */
  banned: boolean;
  /**
   * fair_play: chess.com `closed:fair_play_violations`;
   * tos: lichess `tosViolation` (lichess does not distinguish cheating from other violations);
   * other: closed for unknown reasons.
   */
  banReason?: 'fair_play' | 'tos' | 'other';
  /** lichess: account closed by the user themself */
  disabled?: boolean;
}

/**
 * Minimal async key-value cache the platform clients can use.
 * apps/web implements this over IndexedDB; Node tools can use an in-memory map.
 */
export interface KvCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
}
