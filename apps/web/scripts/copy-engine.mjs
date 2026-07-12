// Copies the Stockfish lite single-threaded build into public/engine/ (gitignored).
// Runs as predev/prebuild. A plain classic worker loads /engine/stockfish-18-lite-single.js,
// and the emscripten glue finds its .wasm next to it — bundling would break that lookup.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bin = join(dirname(require.resolve('stockfish/package.json')), 'bin');
const dest = fileURLToPath(new URL('../public/engine/', import.meta.url));

mkdirSync(dest, { recursive: true });
for (const file of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  copyFileSync(join(bin, file), join(dest, file));
}
console.log('copied stockfish engine to public/engine');
