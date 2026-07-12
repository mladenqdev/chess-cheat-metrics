import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import ndjson from './__fixtures__/lichess-games.ndjson?raw';
import { normalizeLichessGame, normalizeLichessProfile, type LichessGame } from './lichess';

const [plainGame, analysedGame] = ndjson
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as LichessGame);

describe('normalizeLichessGame', () => {
  it('replays the san line into uci moves and fens', () => {
    const game = normalizeLichessGame(plainGame!);
    expect(game.moves).toHaveLength(42);
    expect(game.moves[0]).toMatchObject({ san: 'e4', uci: 'e2e4', fenBefore: INITIAL_FEN });
    expect(game.moves[1]!.san).toBe('c5');
    expect(game.moves[1]!.uci).toBe('c7c5');
  });

  it('maps centisecond clocks to ms, zipping defensively', () => {
    const game = normalizeLichessGame(plainGame!);
    // fixture has 43 clock entries for 42 moves — extra entry must be ignored
    expect(game.moves[0]!.clockAfterMs).toBe(300_030);
    expect(game.moves.every((m) => m.clockAfterMs !== undefined)).toBe(true);
  });

  it('maps game metadata', () => {
    const game = normalizeLichessGame(plainGame!);
    expect(game).toMatchObject({
      platform: 'lichess',
      id: 'BqkNfmi9',
      rated: true,
      timeClass: 'blitz',
      timeControl: { initialSec: 300, incrementSec: 3 },
      result: '0-1',
      termination: 'resign',
      eco: 'B21',
      openingPly: 6,
      hasPlatformEvals: false,
    });
    expect(game.white.username).toBe('spasski76');
    expect(game.black.rating).toBe(1704);
    expect(game.white.accuracy).toBeUndefined();
  });

  it('attaches per-move evals and judgments when the game has server analysis', () => {
    const game = normalizeLichessGame(analysedGame!);
    expect(game.hasPlatformEvals).toBe(true);
    expect(game.moves[0]!.evalAfter).toEqual({ cp: 18 });
    expect(game.moves[5]!.evalAfter).toEqual({ cp: 98 });
    expect(game.moves[5]!.judgment).toBe('inaccuracy');
    expect(game.moves.filter((m) => m.judgment === 'blunder').length).toBeGreaterThan(0);
  });

  it('maps platform accuracy and acpl per player', () => {
    const game = normalizeLichessGame(analysedGame!);
    expect(game.white).toMatchObject({ username: 'thibault', accuracy: 75, acpl: 67 });
    expect(game.black).toMatchObject({ username: 'entropi', accuracy: 81, acpl: 50 });
  });
});

describe('normalizeLichessProfile', () => {
  it('maps ratings, counts and tos flag', () => {
    const profile = normalizeLichessProfile({
      id: 'suspect',
      username: 'Suspect',
      createdAt: 1700000000000,
      tosViolation: true,
      perfs: { blitz: { rating: 2350, games: 900 }, ultraBullet: { rating: 1800 } },
      count: { all: 1234 },
    });
    expect(profile).toMatchObject({
      platform: 'lichess',
      username: 'Suspect',
      createdAt: 1700000000000,
      totalGames: 1234,
      banned: true,
      banReason: 'tos',
    });
    expect(profile.ratings).toEqual({ blitz: 2350, ultrabullet: 1800 });
  });

  it('leaves clean accounts unflagged', () => {
    const profile = normalizeLichessProfile({ id: 'a', username: 'a' });
    expect(profile.banned).toBe(false);
    expect(profile.banReason).toBeUndefined();
  });
});
