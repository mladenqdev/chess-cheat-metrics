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
