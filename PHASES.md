# phases log

Running record of implementation phases. Each entry is written when the phase is done: what
was built, which decisions were made and why, and what future phases (or future us) should know.
The full plan lives outside the repo; the short version: data layer → engine layer → metrics
engine → report UI → calibration → deploy.

## phase 1 — scaffold (done 2026-07-12)

### what was done

- pnpm monorepo: `apps/web` (React 19 + Vite 8 + TS), `packages/core` (pure TS metrics lib,
  no DOM), `tools/calibrate` (local Node scripts, tsx runner).
- Tooling: ESLint 10 flat config + typescript-eslint, Prettier, Vitest (in core).
- `packages/core` seeded with the lichess Win% formula (`winPercentFromCentipawns`) plus real
  unit tests, so the test pipeline was proven on product code, not a placeholder.
- Pushed to git@github.com:mladenqdev/chess-cheat-metrics.git.

### decisions

- **Core is consumed as TypeScript source** (`exports: "./src/index.ts"`): Vite compiles it as
  part of the web build; `tsc` in core is typecheck-only (`noEmit`). No build artifacts, no
  publishing overhead — everything is private workspace code.
- **TypeScript pinned to ^5.9 at the root**: typescript-eslint 8.x crashes against TypeScript 7
  (the native compiler) — it requires the 5.x/6.x JS API. Revisit when typescript-eslint
  supports TS7.
- **`.claude/` is gitignored**: the repo is public; local assistant/tooling config stays out.
- **`allowBuilds: esbuild: true`** in pnpm-workspace.yaml: pnpm 11 blocks postinstall scripts
  by default; esbuild (vite dependency) needs its binary install approved.

### notes for future

- Unpin TypeScript when typescript-eslint supports TS7.
- If we switch to multithreaded Stockfish WASM later, the site must be served with
  COOP/COEP headers (Cloudflare Pages `_headers` file) — single-threaded lite build needs nothing.
- Commit style: lowercase, clear, no co-author trailers.

## phase 2 — data layer (done 2026-07-12)

### what was done

- `packages/core`: typed clients + normalizers for both platforms
  (`platforms/lichess.ts`, `platforms/chesscom.ts`), shared `NormalizedGame` /
  `NormalizedProfile` model (`types.ts`), http helper with 429-retry (`http.ts`),
  SAN replay via chessops (`replay.ts`).
- 20 unit tests against **real captured API responses** (`platforms/__fixtures__/`),
  plus a live smoke test (`tools/calibrate/src/smoke.ts`,
  run: `pnpm --filter @ccm/calibrate exec tsx src/smoke.ts`).
- `apps/web`: IndexedDB `KvCache` implementation (`lib/idbCache.ts`, idb-keyval) and a
  dev-harness page that fetches profile + 20 recent games in the browser (replaced by the
  real UI in phase 5).

### decisions

- **Moves are fully materialized at normalization time**: every move gets `san`, `uci` and
  `fenBefore` by replaying the game with chessops. Costs a few ms per game and makes the
  engine layer trivial — it just consumes FENs and compares UCIs against PVs.
- **Eval semantics**: `evalAfter` is the platform eval of the position _after_ the move,
  white POV, lichess only (`hasPlatformEvals` flags it). chess.com never exposes per-move
  evals; its per-game `accuracies` map to `player.accuracy` when Game Review ran.
- **Clocks**: lichess `clocks` are centiseconds remaining after each move (array can be ±1
  vs the move list — zip defensively); chess.com `%clk` PGN comments parsed with chessops
  `parseComment`. Both normalize to `clockAfterMs` (remaining, not spent).
- **chess.com serial queue is module-level**: every request in the module shares one
  `SerialQueue`, since parallel requests per client get 429'd. 429s wait `Retry-After`
  (default 60s, lichess guidance) and retry at most twice.
- **Caching is an injected `KvCache` interface** (core stays DOM-free): web passes the
  IndexedDB impl; Node tools can pass a Map-based one. TTLs: profiles 1h, lichess game
  exports 10min, chess.com past months **forever** (immutable), newest month 10min.
- **Standard chess only**: variants and custom-position games are filtered out
  (`isSupportedChesscomGame`, lichess `variant === 'standard' && !initialFen`).
- **Do not early-break inside a chess.com month**: games within a month are ordered
  oldest-first, so the whole month is normalized, then sorted desc and sliced — breaking
  early would silently return the oldest games of the month instead of the newest.
- **Core typing is browser-first** (`lib: DOM`) but the code runs on Node 18+ too — the
  calibrate tool imports the same clients.
- Rating semantics differ per platform (lichess pre-game, chess.com post-game) — documented
  on the type, fine for rating-band bucketing.

### notes for future

- Lichess evals arrive only for games that already have server analysis (1 of 5 in the
  smoke sample) — the engine layer (phase 3) fills the rest; that was always the plan.
- Think-time per move must be derived as `prevClock − clock + increment` — increment
  handling lives in the metrics phase, which is why we store remaining clock, not deltas.
- Correspondence/daily games have no clocks → exclude from move-time forensics.
- `openingPly` exists only for lichess games; chess.com games rely on the fixed
  opening cutoff in the eligible-position filter (metrics phase).
- Lichess rating-history endpoint (`/api/user/{u}/rating-history`) is not yet consumed —
  needed for the longitudinal metrics (phase 4+).
- Game exports are buffered, not streamed — fine up to a few hundred games; revisit if we
  ever pull thousands.

## phase 3 — engine layer (done 2026-07-12)

### what was done

- `packages/core/src/engine/`: white-POV eval types (`types.ts`), transport-agnostic UCI
  session with info-line parser (`uci.ts`), cloud-eval client (`cloudEval.ts`),
  eligible-position filter (`eligibility.ts`), and the cache → cloud → local orchestrator
  (`analyser.ts`). 16 new unit tests (36 total).
- `apps/web`: Stockfish worker pool (`engine/stockfishPool.ts`), engine files copied to
  `public/engine/` by `scripts/copy-engine.mjs` (predev/prebuild), harness "analyze" flow
  showing eligibility/exclusions/sources/depth per game.
- End-to-end verified headless (Playwright + system Chrome): 3 real lichess games analysed
  in 16s — eligible 48/70, 13/48 (blowout → decided:18), 33/52; sources cloud:17–23 (opening)
  rest local; avg depth 18.9–25 (cloud evals are deeper than our depth-12 local searches).

### decisions

- **White POV everywhere** for cp/mate; PVs ordered best-for-mover. Cloud-eval convention
  verified empirically (black-to-move mate-in-1 reports `mate: -1` → white POV). Local UCI
  engines report side-to-move POV — converted at the UCI boundary, nowhere else.
- **UCI session is transport-agnostic** (`UciTransport` interface): the web app wraps a Web
  Worker; phase 6 can wrap the stockfish npm package in Node and reuse the same session,
  parser and POV conversion.
- **Engine ships as a static asset** (`/engine/stockfish-18-lite-single.js` + `.wasm`, 7MB,
  single-threaded lite build, no COOP/COEP needed). vite-plugin-static-copy was tried and
  removed — it fails to flatten paths through pnpm's symlinked node_modules; a plain Node
  copy script as predev/prebuild is deterministic. `public/engine/` is gitignored and
  eslint-ignored.
- **stockfish npm package 18.0.8 ships engines in `bin/`**, not `src/` as the README suggests.
- **Cloud-eval client never throws and never sleeps**: 404 (position unknown) → undefined,
  429 → self-disables for 2min, network error → undefined; caller falls through to the local
  engine. Requests serialized; only positions at ply < 24 are asked (hit rate ≈ 0 beyond).
- **Eval cache key is the fen** (`eval:v1:{fen}`), validity = stored depth ≥ requested AND
  (pvs ≥ requested multiPv OR requestedMultiPv ≥ requested — a position can legally have
  fewer PVs than asked). Positions are deduped within a game before evaluation.
- **A failed local eval yields `undefined`, never an exception** — the position shows up as
  a `no-eval` exclusion instead of sinking the whole game analysis.
- **Pool defaults**: min(4, cores−2) single-threaded workers, round-robin dispatch, each
  session serializes its own searches (UCI engines run one search at a time).

### notes for future

- The browser console logs a 404 error line for every cloud-eval miss (handled, but noisy) —
  cosmetic; also `favicon.ico` 404s (no favicon yet).
- Round-robin dispatch can imbalance when position analysis times vary a lot; a shared
  work queue with idle-worker pickup would fix it if it ever matters.
- Default analysis depth is 12 (lite NNUE at depth 12 ≈ low-GM strength; cloud fills deeper
  where available). The metrics phase may want per-time-class or adaptive depth.
- Platform evals (lichess `analysis`) are single-PV and can't feed T1/T2/T3 — the engine
  layer always produces its own multiPV evals; platform values stay as a cross-check.
- Playwright headless verification lives in the session scratchpad, not the repo — consider
  a committed e2e script later if it earns its keep.

## phase 4 — metrics engine (done 2026-07-12)

### what was done

- `packages/core/src/metrics/`: statistics utilities incl. Wilson intervals (`stats.ts`),
  the lichess accuracy-formula port (`accuracy.ts`), per-move centipawn loss (`cpl.ts`),
  engine-match ranking T1/T2/T3 (`engineMatch.ts`), think-time derivation + stats
  (`time.ts`), and per-player game metrics + aggregation with the 120-move sample gate
  (`playerReport.ts`). Built TDD — tests written first; 29 new tests (65 total).
- Harness now shows, after analysis: an aggregate line (T1/T2/T3 rates with Wilson CI,
  acpl, accuracy, think-time stats, sample-gate warning) and per-game player metrics.
- Verified headless on real lichess games: per-game T1/T2/T3, acpl and accuracy rendered;
  sample gate correctly flagged 48 < 120 eligible moves and withheld the stat summaries.

### decisions

- **The accuracy port is proven by a golden test**: the analysed fixture game's platform
  evals fed through our `gameAccuracy` reproduce lichess's reported accuracies exactly
  (75 white / 81 black). Port details that mattered: `Cp.initial = 15`, cp ceiled to ±1000
  before the win% sigmoid, the +1 "uncertainty bonus", weights = window-stddev clamped
  [0.5, 12], windowSize = clamp(moves/10, 2, 8), final = mean(weighted mean, harmonic mean).
- **CPL ground-truth order**: played == top move → 0; else eval of the resulting position
  (deeper search of the actual continuation); else the matched multiPV line's score; else
  undefined (excluded, never guessed). Conceded mates cap at 1000cp (PGN-Spy convention).
- **cps for game accuracy come from the NEXT position's eval** (`evals[ply+1]`), so the
  final move of a game has no accuracy contribution — same hole semantics lichess uses
  for mate scores. Positions after the last move are never engine-evaluated.
- **T2/T3 are cumulative** (T2 includes T1), matching PGN-Spy's reporting.
- **Think time = prevOwnClock − clock + increment**, clamped at 0 (lag compensation can
  go negative). Timing metrics use only the player's _eligible_ moves — premoves and
  book moves would poison flat-timing detection.
- **The sample gate withholds stat summaries entirely** (acpl/accuracy/timing are
  `undefined` below 120 eligible moves) rather than showing them with a caveat — a tiny
  sample reads as precision it doesn't have. Match rates still show (with their wide CIs).
- **Rating-conditioned z-scores and baselines deferred to phase 6** — inventing seed
  sigmas now would produce authoritative-looking nonsense; raw metrics + CIs are honest.

### notes for future

- T1 rates at depth 12 with the lite engine run high in absolute terms (a 1700 showed 56%
  on a 48-move sample) — never interpret raw match rates without the rating-conditioned
  baselines (phase 6), and consider measuring baselines at the exact depth/engine the site
  ships, since match rates are engine- and depth-relative.
- Aggregate accuracy is a plain mean of per-game accuracies; lichess defines no cross-game
  aggregate, so ours is a choice — revisit if move-count weighting proves fairer.
- Flat-timing detection (low CV) is summarised but not yet flagged/scored — composite
  scoring lands with the report UI (phase 5) + baselines (phase 6).
- chess.com games never carry platform accuracy for cross-checking our numbers in the
  harness — the lichess golden test covers formula fidelity instead.

## v1.1 — anti-smurf metrics (2026-07-13)

Prompted by a real case: a fresh account (2 days, 55 games, blitz 2480) whose move quality
sits dead-center in its cohort — undetectable by rating-relative metrics because its rating
IS its (possibly assisted) performance. Two rating-independent signals added, both
**one-sided** (only ever add suspicion):

- **Consistency across games** (`accuracyStd`): std of per-game accuracy. Humans swing
  (form, tilt, time trouble); assistance is metronomic. Needs ≥5 games with accuracy.
- **Time follows difficulty** (`timeComplexityCorr`): Spearman corr between think time and
  the PV1−PV2 gap on eligible moves, pooled across games. Humans think longer on hard
  choices (negative corr); assistance plays at its own pace (corr ≈ 0). Needs ≥30 pairs.
  This is the "uniform 5–6s per move" catcher.

Composite reweighted: t1 .30, acpl .30, accuracy .15, consistency .10, time-blindness .10,
instant .025, flatness .025. New baseline fields are OPTIONAL on BandBaseline — the current
table lacks them, so the new z's stay undefined until the next calibration run measures
them (`run full` now writes `data/metrics-v2.jsonl`; old v1 datapoints lack per-player
spread/corr and can't be reused for these fields). Test learning: synthetic PVs must be
ordered best-for-the-mover (ascending white-cp for black) — the engine convention.

## phase 5 — report ui (done 2026-07-12)

### what was done

- Replaced the dev harness with the real product UI: hash routing (`#/`, `#/methodology`,
  `#/u/<platform>/<user>` deep links that auto-run), `report/useReport.ts` orchestration
  hook (fetch → per-game engine analysis with progress → metrics → aggregate → tier),
  `ReportPage` (hero, search form, progress view), `ReportView` (tier banner, metric cards
  with inline-SVG Wilson-CI bars, per-game table, disclaimer), `MethodologyPage`
  (full plain-language writeup), placeholder design tokens in `styles.css`.
- `packages/core`: `reportTier()` — honest headline states until calibration:
  `flagged-by-platform` / `insufficient-sample` / `uncalibrated` (+ tests, 68 total).
- Verified headless: 10 games in 47s; sample gate fired at 116/120 and correctly withheld
  acpl/accuracy/timing summaries; our per-game accuracy landed within ~1–4 points of
  lichess's reported values on the two platform-analysed games (cross-validation on top
  of the golden test); methodology route renders; deep-link URL written on submit.

### decisions

- **Design system pending, so tokens are placeholders**: CSS custom properties, dark-first
  with `prefers-color-scheme` light override, gold/tan accent per the chosen "chessboard"
  palette. The design agent's "Ledger" direction will replace token values and refine
  components — the structure (cards, tier banner, CI bars, tables) already matches it.
- **No verdict states are shipped that the math can't back**: `reportTier` only knows
  platform flags, the sample gate, and "uncalibrated". The cohort tier slider
  (normal/unusual/extreme) arrives with phase 6 baselines.
- **Deep links re-run the analysis** rather than loading a stored report — there is no
  backend; the URL encodes (platform, username) and caches make re-runs cheap.
- **Progress copy doubles as a privacy statement** ("nothing is uploaded — the engine
  runs locally"), which is both true and a differentiator worth surfacing mid-wait.
- react-hooks v7 lint shaped the deep-link implementation: no setState in effects, no
  ref reads during render → lazy `useState` initializers parsing the hash.

### notes for future

- Cloud-eval hit a 429 once in a 10-game run — the self-disable fallback worked, but
  consider lowering `cloudPlyLimit` or widening the disable window when calibration
  hammers the API (phase 6 should probably run cloud-eval-free).
- Design integration TODO: port the Ledger design system (fonts, exact tokens, tier
  slider, cohort tick marks, "engine agreement by depth" bars), fix its "Stockfish 16"
  copy to 18, add favicon + og-image for the screenshot crop.
- The progress view still lacks the live mini chessboard the design mocks — FENs are
  available; add when porting the design.
- Per-game "suspicion sort" (plan's phase-5 item) deferred to calibration: sorting by
  raw T1% without baselines would imply meaning the numbers don't have yet.

## phase 6 — calibration (pilot done 2026-07-12; full run pending)

### what was done

- `packages/core/src/metrics/baselines.ts`: baseline table types, `findBand`,
  `compareToCohort` (per-metric z-scores oriented so positive = engine-like, combined
  with **Stouffer's weighted method** Σ(w·z)/√Σw², weights t1 .35 / acpl .35 /
  accuracy .2 / timing .05+.05, tiers: unusual ≥ 2, extreme ≥ 3.5). `reportTier` now
  returns normal/unusual/extreme when a comparison exists. 75 tests total.
- `tools/calibrate`: `nodeEngine.ts` (runs the exact production WASM engine in Node via
  the shared UCI session), `sample.ts` (players per rating band from big finished lichess
  blitz arenas), `calibrate.ts` (resumable per-player pipeline → JSONL),
  `build-baselines.ts` (band means/stds → `baselines.generated.json` in core),
  `validate.ts` (labeled banned/clean accounts → composite z + pairwise AUC).
- **Pilot run**: 3 blitz bands (1200–1600, 1600–2000, 2000–2400) × 4 players × 6 games,
  4 minutes total (~16s/player). Even at n≈4 the physics show: accuracy 78.0 → 80.5 →
  85.6 and acpl 54 → 56 → 42 across bands. Table committed with `pilot: true`.
- UI: tier banner renders the three cohort states with the composite score and an
  explicit provisional label; metric cards show "cohort: mean±std" footnotes.
- Verified headless via deep link: thibault (blitz 1712, 20 games, 291 decisions) →
  **"Consistent with the rating cohort", composite 1.0** — the right answer for a
  legitimate ~1700.

### decisions

- **Stouffer, not a weighted mean**: TDD caught that averaging z-scores lets three
  independent 2–4σ anomalies dilute each other; Σ(w·z)/√Σw² accumulates evidence
  properly (engine-like test profile: 2.9 → 5.4).
- **Calibration runs the identical engine/depth as production** (stockfish 18 lite
  single WASM, depth 12, multiPv 3) — match rates are engine- and depth-relative, so
  published or otherwise-measured baselines would be systematically wrong.
- **Baselines are distributions of player-level aggregates per band**, and the product
  z-scores a player against that population; calibration datapoints bypass the 120-move
  product gate (`rawDatapoint`) because population statistics live at the band level.
- **Pilot table ships but is always marked provisional** (`meta.pilot` or
  `nPlayers < MIN_BAND_PLAYERS=20`) — the UI says so under the tier.
- **Cloud-eval is off during calibration** — mass runs shouldn't lean on lichess's cache,
  and the local engine is fast enough (~150ms/position).
- Sampling comes from finished high-population blitz arenas (wide rating spread, active
  accounts, includes ratings without extra API calls).

### stockfish-npm-in-node gotchas (hard-won, do not rediscover)

- `locateFile` receives the GENERIC name `stockfish.wasm` — always return the
  lite-single wasm path, or it loads the 107MB multithreaded binary and dies on a
  memory-import LinkError.
- The glue **nulls global `fetch` in Node** (to force its fs loading path) — snapshot
  and restore `globalThis.fetch` around init or every later API call breaks.
- The output hook is **`listener`**, not `print` — the glue overrides `print` with a
  function that prefers `listener` and falls back to console.log.
- A failed UCI init used to cache its rejected promise and poison every later evaluate —
  `ensureInit` now clears itself on rejection (fixed in core).

### notes for future

- **Full calibration is one overnight command sequence**: `sample.ts --per-band 30` →
  `calibrate.ts --games 10` (resumable; ~16s/player-game-6 → budget accordingly) →
  `build-baselines.ts --pilot false`. Extend BANDS with sub-1200, 2400+, and
  bullet/rapid time classes when doing it.
- `validate.ts` is ready but needs a labels file of banned/clean accounts
  (fair-play-closed chess.com accounts keep public archives); run it after full
  calibration to tune tier thresholds against ROC/AUC instead of the current 2/3.5.
- v1 compares a mixed-time-class aggregate against the dominant class's band —
  refine to per-class aggregates if reports often mix classes.
- One long drawn game showed ours 84.2 vs platform 61 accuracy — eval-source variance
  (depth 12 vs lichess's deeper server analysis) on a volatile game, not a formula bug
  (the golden test pins the formula). Expect such per-game spreads; aggregates smooth them.

### addendum (same day): lessons from a real suspect account

A user-supplied suspect (chess.com blitz 2480, account **1 day old**, 55 games) exposed
three gaps, all fixed:

- **Bands now reach 2400–3000** (and sampling takes `--bands`/`--time-class`; high bands
  top up from the tail of the lichess leaderboard when arenas run dry). Rapid pilot bands
  added where this hour's arenas allowed (1200–1600, 2400–3000); middle rapid bands fill
  on the full run. Resume key fixed to username+timeClass.
- **Timing z-scores are one-sided now**: varied timing must not subtract suspicion —
  assistance can fake thinking time. Flat timing still adds.
- **Context flags UI**: fresh account (<90d) / few games (<300) / already-high rating
  (≥2200) render as an amber facts box under the tier — plan metric #8, surfaced
  prominently instead of buried in the profile line.

**Coverage completed same evening**: rapid arenas alone couldn't fill 1600–2400 (that
hour's arenas skewed low), so `sample.ts` gained a **bulk-profile fallback** — collect
every username from all recent big arenas regardless of time class, `POST /api/users`
(300/call), keep those whose rating in the target class fits the band with ≥30 real
games. All 8 bands (blitz + rapid, 1200–3000, 31 players) now measured. Validation on
real accounts: a user-supplied rapid suspect (2130, acpl 17, accuracy 92.2, account 18
days old) scored **composite 8.4 → extreme**, while the user's own honest account (rapid 2079) scored **−1.3 → normal** — clean separation with the same algorithm.

**Full calibration completed overnight (2026-07-13)**: 645 player datapoints, 608 kept
(≥40 eligible moves), 12 bands with n=53–64 everywhere except 400–800 (n=2–3 — lichess
ratings bottom out ~600–800, as predicted; those bands stay small-group-flagged). The
curves are textbook-monotonic: T1 22.5→43.0%, acpl 88→24, accuracy 73.9→90.2 across
bands, rapid think-time cv consistently above blitz. Notable recalibration effect: the
real population's spreads are wider than the 4-player pilot's artificially tight ones,
so the suspect's score corrected from 8.4 to 3.7 — still extreme, now honestly so.
Verification: suspect account "extreme 3.7", user's own account "normal −1.0", both
without small-group warnings.

The instructive outcome: the first suspect's move metrics sit dead-center in the measured
2400–3000 cohort (T1 40.9 vs 41.8±2.9, acpl 30 vs 27±2, accuracy 91.0 vs 89.8±0.8) —
composite −0.8, tier "consistent". **Engine-agreement metrics catch players performing
above their rating; they cannot separate a fresh account that entered at its playing
strength from a strong player on a smurf** — there is no mismatch to detect. For such
accounts the discriminating evidence is the trajectory (1 day, 55 games, 2480) — which
the report now shouts via context flags — plus, later: selectivity/clutch metrics,
opponent-ban rates, bigger samples at higher depth. Also noted: chess.com ratings are
being compared against lichess-derived bands (systematically strong cohort = conservative,
fewer false flags); per-platform baselines are the eventual fix.
