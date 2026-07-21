# chesscheatdetection

Statistical anomaly reports for chess.com and lichess accounts. Enter a username, the site
downloads the player's recent games via the platforms' public APIs, analyses every move with
Stockfish (WASM, in your browser) and compares the numbers against what is statistically normal
for the player's rating.

**This site reports statistical evidence, never verdicts.** No metric here can prove cheating;
the output is "consistent with / anomalous relative to the player's rating cohort", with
confidence intervals and sample-size gates.

## Workspace layout

- `apps/web` — React + Vite frontend: API clients, Stockfish worker pool, report dashboard
- `packages/core` — pure TypeScript metrics library (game normalization, eligible-position
  filter, engine-correlation / centipawn-loss / accuracy / move-time metrics, statistics)
- `tools/calibrate` — local scripts that sample real players to build the rating-band baseline
  curves shipped with the frontend

## Development

```sh
pnpm install
pnpm dev     # start the web app
pnpm test    # run unit tests
pnpm build   # typecheck + production build
pnpm lint
```
