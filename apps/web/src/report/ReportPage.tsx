import type { Platform } from '@ccm/core';
import { useEffect, useState, type FormEvent } from 'react';
import { ReportView } from './ReportView';
import { parseReportPath, useReport, type ReportState } from './useReport';

const GAME_COUNTS = [10, 20, 30, 50];

function ProgressView({ state }: { state: ReportState & { phase: 'analyzing' } }) {
  const { currentGame, gameIndex, gamesTotal, positionsDone, positionsTotal } = state;
  const overall = (gameIndex + positionsDone / Math.max(1, positionsTotal)) / gamesTotal;
  return (
    <section className="panel progress" aria-live="polite">
      <h2>Analyzing with Stockfish in your browser…</h2>
      <progress value={overall} max={1} style={{ width: '100%' }} />
      <p className="muted">
        game {gameIndex + 1} of {gamesTotal}: {currentGame.white.username} vs{' '}
        {currentGame.black.username} · position {positionsDone}/{positionsTotal}
      </p>
      <p className="muted small">
        Nothing is uploaded anywhere: the engine runs locally and the games come from the public{' '}
        {state.profile.platform === 'lichess' ? 'lichess' : 'chess.com'} API.
      </p>
    </section>
  );
}

export function ReportPage() {
  // deep link: /u/<platform>/<username> seeds the form and auto-runs a report
  const [platform, setPlatform] = useState<Platform>(
    () => parseReportPath(window.location.pathname)?.platform ?? 'lichess',
  );
  const [username, setUsername] = useState(
    () => parseReportPath(window.location.pathname)?.username ?? '',
  );
  const [maxGames, setMaxGames] = useState(20);
  const { state, run } = useReport();

  useEffect(() => {
    const target = parseReportPath(window.location.pathname);
    if (target) void run(target.platform, target.username, 20);
  }, [run]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    if (!name || state.phase === 'fetching' || state.phase === 'analyzing') return;
    window.history.pushState({}, '', `/u/${platform}/${name}`);
    void run(platform, name, maxGames);
  }

  const busy = state.phase === 'fetching' || state.phase === 'analyzing';

  return (
    <>
      <section className="hero">
        <h1>Is that account playing like a human?</h1>
        <p className="muted">
          We compare a player's games to honest players at the same rating: how often they match the
          engine, how big their mistakes are, and how they spend their clock.
        </p>
        <form onSubmit={onSubmit} className="search" aria-label="analyze a player">
          <select
            value={platform}
            aria-label="platform"
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            <option value="lichess">lichess</option>
            <option value="chesscom">chess.com</option>
          </select>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            aria-label="username"
            required
          />
          <select
            value={maxGames}
            aria-label="games to analyze"
            onChange={(e) => setMaxGames(Number(e.target.value))}
          >
            {GAME_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n} games
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            {busy ? 'working…' : 'analyze'}
          </button>
        </form>
      </section>

      {state.phase === 'fetching' && (
        <section className="panel" aria-live="polite">
          <p>Fetching {state.username}'s profile and games…</p>
        </section>
      )}
      {state.phase === 'analyzing' && <ProgressView state={state} />}
      {state.phase === 'error' && (
        <section className="panel error" role="alert">
          <p>{state.message}</p>
        </section>
      )}
      {state.phase === 'done' && <ReportView data={state.data} />}

      {state.phase === 'idle' && (
        <section className="how">
          <h2>How it works</h2>
          <ol>
            <li>We download the player's recent games from the platform's public API.</li>
            <li>
              Your browser replays every move through Stockfish and keeps only the positions that
              prove something: no book moves, no forced moves, no already decided positions.
            </li>
            <li>
              Every number comes with its likely range and a comparison to real players at the same
              rating, and below 120 analyzed decisions the report refuses to conclude anything.
            </li>
          </ol>
          <p className="muted small">
            <a href="/methodology">Read the full methodology</a>, including what this site can and
            cannot know.
          </p>
        </section>
      )}
    </>
  );
}
