import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';

export interface ReplayedMove {
  san: string;
  uci: string;
  fenBefore: string;
}

/**
 * Replays a standard-chess SAN line from the initial position, producing the UCI
 * move and the FEN each move was played in. The FENs are what the analysis
 * pipeline feeds to cloud-eval / Stockfish; UCI is what engine PVs are matched against.
 */
export function replaySanMoves(sans: string[]): ReplayedMove[] {
  const pos = Chess.default();
  const out: ReplayedMove[] = [];
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal or unparseable san "${san}" at ply ${out.length + 1}`);
    out.push({ san, uci: makeUci(move), fenBefore: makeFen(pos.toSetup()) });
    pos.play(move);
  }
  return out;
}
