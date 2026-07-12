import { mean, type RateWithCi } from '@ccm/core';
import type { AnalyzedGame, ReportData } from './useReport';

function TierBanner({ data }: { data: ReportData }) {
  const { tier, profile, aggregate } = data;
  if (tier === 'flagged-by-platform') {
    return (
      <section className="tier tier-flagged" role="status">
        <h2>Closed by the platform</h2>
        <p>
          {profile.platform === 'chesscom'
            ? `chess.com closed this account${profile.banReason === 'fair_play' ? ' for fair-play violations' : ''}.`
            : 'lichess marked this account for a terms-of-service violation.'}{' '}
          That is the platform's own public flag, independent of our analysis below.
        </p>
      </section>
    );
  }
  if (tier === 'insufficient-sample') {
    return (
      <section className="tier tier-insufficient" role="status">
        <h2>Not enough evidence</h2>
        <p>
          Only {aggregate.eligible} of the required 120 analyzable decisions — no conclusion is
          statistically defensible on a sample this small. Analyze more games.
        </p>
      </section>
    );
  }

  const comparison = data.comparison;
  if (comparison && (tier === 'normal' || tier === 'unusual' || tier === 'extreme')) {
    const { band, composite, provisional } = comparison;
    const cohortLabel = `measured ${band.timeClass} players rated ${band.minRating}–${band.maxRating}`;
    const content = {
      normal: {
        className: 'tier-neutral',
        title: 'Consistent with the rating cohort',
        body: `Engine agreement, mistake profile and timing sit where ${cohortLabel} normally sit (composite anomaly score ${composite.toFixed(1)}).`,
      },
      unusual: {
        className: 'tier-insufficient',
        title: 'Unusual for the rating cohort',
        body: `Some metrics sit above the typical range of ${cohortLabel} (composite anomaly score ${composite.toFixed(1)}). Unusual is not proof — strong form, preparation or style can do this. More games sharpen the picture.`,
      },
      extreme: {
        className: 'tier-flagged',
        title: 'Extremely unusual for the rating cohort',
        body: `Multiple metrics sit far outside the range of ${cohortLabel} (composite anomaly score ${composite.toFixed(1)}). This level of anomaly is rare among honest players — still statistical evidence, not a verdict.`,
      },
    }[tier];
    return (
      <section className={`tier ${content.className}`} role="status">
        <h2>{content.title}</h2>
        <p>{content.body}</p>
        {provisional && (
          <p className="small muted">
            Provisional baseline — built from a pilot sample of {band.nPlayers} players; treat as
            indicative only until full calibration.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="tier tier-neutral" role="status">
      <h2>Metrics computed — no verdict</h2>
      <p>
        {aggregate.eligible} decisions analyzed across {aggregate.games} games. No calibrated
        baseline covers this player's rating and time control yet — read the raw values below with
        their confidence intervals.
      </p>
    </section>
  );
}

function CiBar({ rate }: { rate: RateWithCi }) {
  const [lo, hi] = rate.ci;
  return (
    <svg viewBox="0 0 100 8" className="ci-bar" aria-hidden="true">
      <rect x="0" y="3" width="100" height="2" className="ci-track" />
      <rect x={lo * 100} y="1.5" width={(hi - lo) * 100} height="5" className="ci-band" rx="1" />
      <rect x={rate.rate * 100 - 0.75} y="0" width="1.5" height="8" className="ci-marker" />
    </svg>
  );
}

function RateCard({
  label,
  rate,
  hint,
  cohort,
}: {
  label: string;
  rate: RateWithCi;
  hint: string;
  cohort?: string;
}) {
  return (
    <div className="card metric">
      <h3>{label}</h3>
      <p className="value">
        {(rate.rate * 100).toFixed(1)}%
        <span className="ci muted">
          {' '}
          [{(rate.ci[0] * 100).toFixed(0)}–{(rate.ci[1] * 100).toFixed(0)}]
        </span>
      </p>
      <CiBar rate={rate} />
      <p className="muted small">{hint}</p>
      {cohort && <p className="muted small cohort-line">cohort: {cohort}</p>}
    </div>
  );
}

function ValueCard({
  label,
  value,
  hint,
  cohort,
}: {
  label: string;
  value: string;
  hint: string;
  cohort?: string;
}) {
  return (
    <div className="card metric">
      <h3>{label}</h3>
      <p className="value">{value}</p>
      <p className="muted small">{hint}</p>
      {cohort && <p className="muted small cohort-line">cohort: {cohort}</p>}
    </div>
  );
}

function AccountContext({ data }: { data: ReportData }) {
  const { profile } = data;
  const ratings = Object.entries(profile.ratings)
    .map(([timeClass, rating]) => `${timeClass} ${rating}`)
    .join(' · ');
  return (
    <p className="muted account-line">
      {profile.title && <strong>{profile.title} </strong>}
      joined{' '}
      {profile.createdAt
        ? new Date(profile.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
          })
        : 'unknown'}
      {profile.totalGames !== undefined && <> · {profile.totalGames.toLocaleString()} games</>}
      {ratings && <> · {ratings}</>}
    </p>
  );
}

const FRESH_ACCOUNT_DAYS = 90;
const FEW_GAMES = 300;
const HIGH_RATING = 2200;

/**
 * Non-statistical context flags: facts that amplify the metrics but never
 * convict alone (plan metric #8 — legit smurfs exist). A weeks-old account
 * already playing at a high rating is the classic pattern worth surfacing.
 */
function ContextFlags({ data }: { data: ReportData }) {
  const { profile, finishedAt } = data;
  const flags: string[] = [];
  if (profile.createdAt !== undefined) {
    const ageDays = Math.max(0, Math.round((finishedAt - profile.createdAt) / 86_400_000));
    if (ageDays < FRESH_ACCOUNT_DAYS) flags.push(`account is ${ageDays} days old`);
  }
  if (profile.totalGames !== undefined && profile.totalGames < FEW_GAMES) {
    flags.push(`only ${profile.totalGames} games ever played`);
  }
  const peak = Math.max(0, ...Object.values(profile.ratings));
  if (flags.length > 0 && peak >= HIGH_RATING) {
    flags.push(`already rated ${peak}`);
  }
  if (flags.length === 0) return null;
  return (
    <p className="context-flags">
      <span className="flag-label">context:</span> {flags.join(' · ')} — worth weighing alongside
      the metrics; new accounts can be honest smurfs or returning players.
    </p>
  );
}

function GamesTable({ games }: { games: AnalyzedGame[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th align="left">game</th>
            <th align="left">opponent</th>
            <th>result</th>
            <th>decisions</th>
            <th>top-move %</th>
            <th>acpl</th>
            <th>accuracy</th>
            <th>depth</th>
          </tr>
        </thead>
        <tbody>
          {games.map(({ game, metrics, avgDepth }) => {
            const opponent = metrics?.color === 'white' ? game.black : game.white;
            const won =
              (metrics?.color === 'white' && game.result === '1-0') ||
              (metrics?.color === 'black' && game.result === '0-1');
            return (
              <tr key={game.id}>
                <td>
                  <a href={game.url} target="_blank" rel="noreferrer">
                    {new Date(game.endedAt).toLocaleDateString()} {game.timeClass}
                  </a>
                </td>
                <td>
                  {opponent.username} ({opponent.rating ?? '?'})
                </td>
                <td align="center">
                  {game.result === '1/2-1/2' ? '½' : won ? 'W' : game.result === '*' ? '—' : 'L'}
                </td>
                <td align="center">{metrics?.eligible ?? '—'}</td>
                <td align="center">
                  {metrics && metrics.eligible > 0
                    ? `${((metrics.t1 / metrics.eligible) * 100).toFixed(0)}%`
                    : '—'}
                </td>
                <td align="center">
                  {metrics && metrics.cpls.length > 0 ? mean(metrics.cpls).toFixed(0) : '—'}
                </td>
                <td align="center">
                  {metrics?.accuracy !== undefined ? metrics.accuracy.toFixed(1) : '—'}
                  {metrics?.platformAccuracy !== undefined && (
                    <span className="muted small"> ({metrics.platformAccuracy})</span>
                  )}
                </td>
                <td align="center" className="muted">
                  {avgDepth ? avgDepth.toFixed(0) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReportView({ data }: { data: ReportData }) {
  const { profile, aggregate } = data;
  const band = data.comparison?.band;
  return (
    <article className="report">
      <header className="report-header">
        <h2>
          {profile.username}
          <span className="muted">
            {' '}
            · {profile.platform === 'lichess' ? 'lichess' : 'chess.com'}
          </span>
        </h2>
        <AccountContext data={data} />
      </header>

      <TierBanner data={data} />
      <ContextFlags data={data} />

      <section className="metric-grid">
        <RateCard
          label="Top engine move"
          rate={aggregate.t1}
          hint="How often the played move was Stockfish's #1 choice, in positions with a real decision to make."
          cohort={
            band && `${(band.t1Rate.mean * 100).toFixed(1)}±${(band.t1Rate.std * 100).toFixed(1)}%`
          }
        />
        <RateCard
          label="Top-2 moves"
          rate={aggregate.t2}
          hint="Played one of the engine's two best moves."
          cohort={
            band && `${(band.t2Rate.mean * 100).toFixed(1)}±${(band.t2Rate.std * 100).toFixed(1)}%`
          }
        />
        <RateCard
          label="Top-3 moves"
          rate={aggregate.t3}
          hint="Played one of the engine's three best moves."
          cohort={
            band && `${(band.t3Rate.mean * 100).toFixed(1)}±${(band.t3Rate.std * 100).toFixed(1)}%`
          }
        />
        {aggregate.acpl && (
          <ValueCard
            label="Centipawn loss"
            value={`${aggregate.acpl.mean.toFixed(0)} ± ${aggregate.acpl.std.toFixed(0)}`}
            hint={`Average quality drop per decision (n=${aggregate.acpl.n}). Lower = stronger play.`}
            cohort={band && `${band.acpl.mean.toFixed(0)}±${band.acpl.std.toFixed(0)}`}
          />
        )}
        {aggregate.accuracyMean && (
          <ValueCard
            label="Accuracy"
            value={aggregate.accuracyMean.mean.toFixed(1)}
            hint="Game accuracy (lichess formula), averaged over analyzed games."
            cohort={band && `${band.accuracy.mean.toFixed(1)}±${band.accuracy.std.toFixed(1)}`}
          />
        )}
        {aggregate.timing && (
          <ValueCard
            label="Move timing"
            value={`${(aggregate.timing.medianMs / 1000).toFixed(1)}s median`}
            hint={`Timing spread ${aggregate.timing.coefficientOfVariation.toFixed(2)} (low = suspiciously flat) · ${(
              aggregate.timing.instantRate * 100
            ).toFixed(0)}% instant replies in real decisions.`}
          />
        )}
      </section>

      <section>
        <h3 className="section-title">Analyzed games</h3>
        <GamesTable games={data.games} />
      </section>

      <footer className="disclaimer">
        <p>
          This report is statistical evidence, not an accusation. High engine agreement has innocent
          explanations (forcing styles, prepared lines, strong play); low numbers don't prove
          innocence either. Only the platforms, with data no outsider has, can make fair-play
          decisions. <a href="#/methodology">Methodology</a>.
        </p>
      </footer>
    </article>
  );
}
