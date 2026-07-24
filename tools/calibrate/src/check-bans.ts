// Checks every calibration-cohort player's ban status (chess.com fair-play,
// lichess tosViolation) and writes the banned usernames so build-baselines can
// exclude them. Reuses the metrics files, no re-analysis.
//   pnpm --filter @ccm/calibrate exec tsx src/check-bans.ts
import { getJson } from '@ccm/core';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { USER_AGENT, type PlayerDatapoint } from './shared';

const opts = { userAgent: USER_AGENT };
const OUT = 'data/banned.jsonl';
writeFileSync(OUT, '');

function usernames(...paths: string[]): string[] {
  const set = new Set<string>();
  for (const path of paths) {
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        set.add((JSON.parse(line) as PlayerDatapoint).username.toLowerCase());
      }
    } catch {
      // missing file, skip
    }
  }
  return [...set];
}

// lichess: bulk tosViolation (POST /api/users, up to 300 at a time)
const liUsers = usernames('data/metrics-v3.jsonl');
console.log(`lichess: checking ${liUsers.length} via bulk...`);
let liBanned = 0;
for (let i = 0; i < liUsers.length; i += 300) {
  try {
    const res = await fetch('https://lichess.org/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: liUsers.slice(i, i + 300).join(','),
    });
    if (!res.ok) continue;
    const users = (await res.json()) as { username: string; tosViolation?: boolean }[];
    for (const u of users) {
      if (u.tosViolation) {
        appendFileSync(OUT, JSON.stringify({ platform: 'lichess', username: u.username.toLowerCase() }) + '\n');
        liBanned++;
      }
    }
  } catch {
    // network hiccup, skip batch
  }
}
console.log(`lichess banned: ${liBanned}`);

// chesscom: serial fair-play status
const ccUsers = usernames('data/metrics-chesscom.jsonl', 'data/metrics-chesscom-blitz.jsonl');
console.log(`chesscom: checking ${ccUsers.length} serial...`);
let ccBanned = 0;
let ccChecked = 0;
for (const u of ccUsers) {
  try {
    const j = await getJson<{ status?: string }>(`https://api.chess.com/pub/player/${u}`, opts);
    ccChecked++;
    if ((j.status ?? '').includes('fair_play')) {
      appendFileSync(OUT, JSON.stringify({ platform: 'chesscom', username: u }) + '\n');
      ccBanned++;
    }
  } catch {
    // deleted account (404) or hiccup, skip
  }
  if (ccChecked % 200 === 0) console.log(`  ${ccChecked}/${ccUsers.length}, banned ${ccBanned}`);
}
console.log(`chesscom banned: ${ccBanned}/${ccChecked} (${((100 * ccBanned) / Math.max(1, ccChecked)).toFixed(1)}%)`);
console.log(`wrote ${OUT}`);
