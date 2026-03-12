import { createInitialState, simulateTick } from '../simulation/GameState';
import { GameCommand, Race, TICK_RATE } from '../simulation/types';
import {
  runAllBotAI, createBotContext, BotDifficultyLevel,
  BOT_DIFFICULTY_PRESETS,
} from '../simulation/BotAI';

const MATCHES_PER_PAIR = 20;
const MAX_MATCH_TICKS = 10 * 60 * TICK_RATE; // 10 minutes — enough time for advantages to compound
// Test across multiple races to ensure results aren't race-specific
const TEST_RACES = [Race.Crown, Race.Horde, Race.Demon, Race.Deep, Race.Oozlings];

const LEVELS = [
  BotDifficultyLevel.Easy,
  BotDifficultyLevel.Medium,
  BotDifficultyLevel.Hard,
  BotDifficultyLevel.Nightmare,
];

let nextSeed = 1;

function runAsymmetricMatch(
  bottomDiff: BotDifficultyLevel,
  topDiff: BotDifficultyLevel,
): 'bottom' | 'top' | 'draw' {
  // Cycle through test races to avoid race-specific bias
  const race = TEST_RACES[nextSeed % TEST_RACES.length];
  const state = createInitialState([
    { race, isBot: true },
    { race, isBot: true },
    { race, isBot: true },
    { race, isBot: true },
  ], nextSeed++);  // unique deterministic seed per match

  const ctx = createBotContext(BotDifficultyLevel.Medium); // default doesn't matter
  // Override per-player difficulty: players 0,1 = bottom, 2,3 = top
  ctx.difficulty[0] = BOT_DIFFICULTY_PRESETS[bottomDiff];
  ctx.difficulty[1] = BOT_DIFFICULTY_PRESETS[bottomDiff];
  ctx.difficulty[2] = BOT_DIFFICULTY_PRESETS[topDiff];
  ctx.difficulty[3] = BOT_DIFFICULTY_PRESETS[topDiff];

  const commands: GameCommand[] = [];
  const emit = (cmd: GameCommand) => commands.push(cmd);

  while (state.matchPhase !== 'ended' && state.tick < MAX_MATCH_TICKS) {
    commands.length = 0;
    runAllBotAI(state, ctx, emit);
    simulateTick(state, commands);
  }

  if (state.winner === 0) return 'bottom'; // Team.Bottom
  if (state.winner === 1) return 'top';     // Team.Top
  // Timed out — use HQ HP differential (team that took less damage wins)
  const bottomHp = state.hqHp[0];
  const topHp = state.hqHp[1];
  if (bottomHp > topHp) return 'bottom';
  if (topHp > bottomHp) return 'top';
  return 'draw';
}

function main(): void {
  const n = parseInt(process.argv[2] ?? '', 10) || MATCHES_PER_PAIR;

  console.log(`\nDifficulty validation: ${n} matches per pair, multi-race (${TEST_RACES.length} races)\n`);

  // Header
  const pad = (s: string, w: number) => s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
  console.log(pad('Bottom', 12) + pad('Top', 12) + pad('Bot Wins', 10) + pad('Top Wins', 10) + pad('Draws', 8) + 'Bottom Win%');
  console.log('-'.repeat(64));

  // Test all ordered pairs (including same-difficulty mirrors as sanity check)
  for (const bottom of LEVELS) {
    for (const top of LEVELS) {
      let bWins = 0, tWins = 0, draws = 0;
      for (let i = 0; i < n; i++) {
        const result = runAsymmetricMatch(bottom, top);
        if (result === 'bottom') bWins++;
        else if (result === 'top') tWins++;
        else draws++;
      }
      const total = bWins + tWins + draws;
      const winPct = total > 0 ? Math.round(100 * bWins / total) : 0;
      const bottomIdx = LEVELS.indexOf(bottom);
      const topIdx = LEVELS.indexOf(top);
      const bottomIsHigher = bottomIdx > topIdx;
      const marker = bottom === top ? ' (mirror)' :
        bottomIsHigher
          ? (winPct > 60 ? ' ✓ higher wins' : winPct < 40 ? ' ✗ LOWER wins?!' : '')
          : (winPct < 40 ? ' ✓ higher wins' : winPct > 60 ? ' ✗ LOWER wins?!' : '');
      console.log(
        pad(bottom, 12) + pad(top, 12) +
        pad(String(bWins), 10) + pad(String(tWins), 10) + pad(String(draws), 8) +
        `${winPct}%${marker}`
      );
    }
  }

  // Summary: does each step up in difficulty beat the step below?
  // Run BOTH directions and average to cancel positional bias
  console.log('\n--- Stepwise Summary (bias-corrected, both directions) ---');
  for (let i = 0; i < LEVELS.length - 1; i++) {
    const lower = LEVELS[i];
    const higher = LEVELS[i + 1];
    let hWins = 0, lWins = 0, draws = 0;
    // Higher on bottom
    for (let m = 0; m < n; m++) {
      const r = runAsymmetricMatch(higher, lower);
      if (r === 'bottom') hWins++;
      else if (r === 'top') lWins++;
      else draws++;
    }
    // Higher on top
    for (let m = 0; m < n; m++) {
      const r = runAsymmetricMatch(lower, higher);
      if (r === 'top') hWins++;
      else if (r === 'bottom') lWins++;
      else draws++;
    }
    const total = hWins + lWins + draws;
    const pct = total > 0 ? Math.round(100 * hWins / total) : 0;
    const verdict = pct >= 55 ? '✓ PASS' : pct >= 45 ? '~ MARGINAL' : '✗ FAIL';
    console.log(`${higher} vs ${lower}: ${pct}% win rate for ${higher} (${hWins}W/${lWins}L/${draws}D) → ${verdict}`);
  }

  // Positional bias check: same difficulty, how often does bottom win?
  console.log('\n--- Positional Bias Check (same difficulty, bottom win%) ---');
  for (const level of LEVELS) {
    let bWins = 0, tWins = 0, draws = 0;
    for (let m = 0; m < n * 2; m++) {
      const r = runAsymmetricMatch(level, level);
      if (r === 'bottom') bWins++;
      else if (r === 'top') tWins++;
      else draws++;
    }
    const total = bWins + tWins + draws;
    const pct = total > 0 ? Math.round(100 * bWins / total) : 0;
    console.log(`${pad(level, 12)} bottom wins ${pct}% (${bWins}W/${tWins}L/${draws}D out of ${total})`);
  }

  console.log('');
}

main();
