import { describe, expect, it } from 'vitest';
import gameJson from './__fixtures__/chesscom-game.json?raw';
import bannedProfileJson from './__fixtures__/chesscom-profile-banned.json?raw';
import statsJson from './__fixtures__/chesscom-stats.json?raw';
import {
  isSupportedChesscomGame,
  normalizeChesscomGame,
  normalizeChesscomProfile,
  type ChesscomGame,
  type ChesscomProfileRaw,
  type ChesscomStatsRaw,
} from './chesscom';

const rawGame = JSON.parse(gameJson) as ChesscomGame;
const bannedProfile = JSON.parse(bannedProfileJson) as ChesscomProfileRaw;
const stats = JSON.parse(statsJson) as ChesscomStatsRaw;

describe('normalizeChesscomGame', () => {
  it('parses the pgn mainline into san/uci/fen moves', () => {
    const game = normalizeChesscomGame(rawGame);
    expect(game.moves).toHaveLength(106);
    expect(game.moves[0]).toMatchObject({ san: 'c4', uci: 'c2c4' });
    expect(game.moves[105]!.san).toBe('Qf4+');
  });

  it('extracts %clk comments as ms remaining per move', () => {
    const game = normalizeChesscomGame(rawGame);
    expect(game.moves[0]!.clockAfterMs).toBe(180_000); // 0:03:00
    expect(game.moves[2]!.clockAfterMs).toBe(178_800); // 0:02:58.8
    expect(game.moves.every((m) => m.clockAfterMs !== undefined)).toBe(true);
  });

  it('maps game metadata, result and accuracies', () => {
    const game = normalizeChesscomGame(rawGame);
    expect(game).toMatchObject({
      platform: 'chesscom',
      id: '5d2f8ff4-7544-11f1-b375-f31baa01000f',
      rated: true,
      timeClass: 'blitz',
      timeControl: { initialSec: 180, incrementSec: 0 },
      endedAt: 1782907523000,
      result: '0-1',
      termination: 'resigned',
      eco: 'A13',
      hasPlatformEvals: false,
    });
    expect(game.white).toMatchObject({ username: 'Super-Speed-94', rating: 3009, accuracy: 82.11 });
    expect(game.black).toMatchObject({ username: 'Hikaru', rating: 3402, accuracy: 86.95 });
  });

  it('rejects variants and custom-position games', () => {
    expect(isSupportedChesscomGame(rawGame)).toBe(true);
    expect(isSupportedChesscomGame({ ...rawGame, rules: 'chess960' })).toBe(false);
    expect(isSupportedChesscomGame({ ...rawGame, pgn: undefined })).toBe(false);
    expect(
      isSupportedChesscomGame({ ...rawGame, initial_setup: '8/8/8/8/8/8/8/K6k w - - 0 1' }),
    ).toBe(false);
  });
});

describe('normalizeChesscomProfile', () => {
  it('flags fair-play-closed accounts', () => {
    const profile = normalizeChesscomProfile(bannedProfile, {});
    expect(profile).toMatchObject({
      platform: 'chesscom',
      username: 'dewa_kipas',
      createdAt: 1612583282000,
      banned: true,
      banReason: 'fair_play',
    });
  });

  it('aggregates ratings and total games from stats', () => {
    const profile = normalizeChesscomProfile({ username: 'hikaru', status: 'premium' }, stats);
    expect(profile.banned).toBe(false);
    expect(profile.ratings).toEqual({ blitz: 3420, bullet: 3300, rapid: 2900 });
    expect(profile.totalGames).toBe(35162 + 5474 + 4308 + 160 + 13);
  });
});
