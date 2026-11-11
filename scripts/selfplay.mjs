#!/usr/bin/env node
/**
 * Self-play in Node: level 12 against level 1 with the real engine (Gate 2, logged, not blocking).
 *
 *   node scripts/selfplay.mjs [--strong 12] [--weak 1] [--moves 40] [--seed 1] [--strong-black] [--clock-ms N]
 *
 * Runs the same `public/engine/stockfish-19-lite-single.js` the app ships, through the same driver,
 * level table and humanized picker (src/lib/engine/node.ts, src/lib/levels.ts; loaded directly by
 * Node's TypeScript type stripping, Node 23.6+). Each side gets its own engine instance. The game
 * stops at checkmate, a draw, or after `--moves` full moves. `--clock-ms` gives both sides a clock
 * (no increment), so level 12 thinks 1/20 of it at most instead of 3 s per move.
 *
 * Prints the moves, the result and the material balance; exits 0 when the strong side won or is
 * ahead on material, 1 otherwise.
 */
import { Chess } from 'chess.js';
import { createNodeEngine, engineFileAvailable } from '../src/lib/engine/node.ts';
import { levelSpec } from '../src/lib/levels.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/** mulberry32: a small seeded PRNG so a run can be repeated. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function material(chess) {
  const m = { w: 0, b: 0 };
  for (const row of chess.board()) for (const sq of row) if (sq) m[sq.color] += VALUE[sq.type];
  return m;
}

const strong = Number(arg('strong', 12));
const weak = Number(arg('weak', 1));
const maxMoves = Number(arg('moves', 40));
const seed = Number(arg('seed', 1));
const strongColor = arg('strong-black', false) ? 'b' : 'w';
const clockMs = arg('clock-ms', null) === null ? null : Number(arg('clock-ms', 0));

if (!engineFileAvailable()) {
  console.error('Engine files not found in public/engine/.');
  process.exit(2);
}

const levels = strongColor === 'w' ? { w: strong, b: weak } : { w: weak, b: strong };
const engines = {
  w: createNodeEngine({ rng: seeded(seed * 2 + 1) }),
  b: createNodeEngine({ rng: seeded(seed * 2 + 2) }),
};
await Promise.all([engines.w.load(), engines.b.load()]);

const name = (c) => `${c === 'w' ? 'White' : 'Black'} (level ${levels[c]} ${levelSpec(levels[c]).name})`;
console.log(`${name('w')} vs ${name('b')}, ${maxMoves}-move cap, seed ${seed}${clockMs ? `, clock ${clockMs} ms` : ''}`);

const chess = new Chess();
const clock = clockMs ? { wMs: clockMs, bMs: clockMs, incMs: 0 } : undefined;
const started = Date.now();
let line = '';
while (!chess.isGameOver() && chess.moveNumber() <= maxMoves) {
  const turn = chess.turn();
  const t0 = Date.now();
  const uci = await engines[turn].bestMove(chess.fen(), levels[turn], clock);
  if (clock) clock[`${turn}Ms`] = Math.max(0, clock[`${turn}Ms`] - (Date.now() - t0));
  const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  line += turn === 'w' ? `${chess.moveNumber()}. ${mv.san} ` : `${mv.san} `;
}
engines.w.dispose();
engines.b.dispose();

const m = material(chess);
let result = '*';
let reason = `stopped after ${maxMoves} moves`;
if (chess.isCheckmate()) {
  result = chess.turn() === 'w' ? '0-1' : '1-0';
  reason = 'checkmate';
} else if (chess.isDraw()) {
  result = '1/2-1/2';
  reason = chess.isStalemate()
    ? 'stalemate'
    : chess.isThreefoldRepetition()
      ? 'repetition'
      : chess.isInsufficientMaterial()
        ? 'insufficient material'
        : 'fifty-move rule';
}
const diff = strongColor === 'w' ? m.w - m.b : m.b - m.w;
const strongWon = (result === '1-0' && strongColor === 'w') || (result === '0-1' && strongColor === 'b');

console.log(line.trim());
console.log(`Result: ${result} (${reason}) after ${chess.history().length} plies in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`Material: White ${m.w}, Black ${m.b}; level ${strong} is ${diff >= 0 ? '+' : ''}${diff}`);
console.log(`Final FEN: ${chess.fen()}`);
const ok = strongWon || (result === '*' && diff >= 3);
console.log(ok ? `PASS: level ${strong} ${strongWon ? 'won' : 'is clearly ahead on material'}` : `FAIL: level ${strong} did not win`);
process.exit(ok ? 0 : 1);
