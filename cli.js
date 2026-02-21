#!/usr/bin/env node
const readline = require("readline");
const Engine = require("./engine");

let state = null;

function out(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function runBatch(games = 1000, policyA = "dad-slayer", policyB = "baseline") {
  const stats = { games, policyA, policyB, p1: 0, p2: 0, tie: 0, avgTurns: 0 };
  let turnsTotal = 0;

  for (let i = 0; i < games; i += 1) {
    let s = Engine.initGame({ seed: Date.now() + i });
    let turns = 0;
    while (s.phase === "play" && turns < 10000) {
      const current = s.currentPlayer;
      const policy = current === 0 ? policyA : policyB;
      const move = Engine.pickMove(s, policy, current);
      if (!move) break;
      const res = Engine.applyAction(s, move);
      s = res.state;
      turns += 1;
    }
    Engine.finalizeWinner(s);
    turnsTotal += turns;
    if (s.winner === "Tie") stats.tie += 1;
    else if (s.winner === s.players[0].name) stats.p1 += 1;
    else stats.p2 += 1;
  }

  stats.avgTurns = Number((turnsTotal / Math.max(games, 1)).toFixed(2));
  return stats;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

out({ ok: true, ready: true, protocol: "gofish-cli.v1" });

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    out({ ok: false, error: "invalid-json" });
    return;
  }

  const cmd = msg && msg.cmd;
  if (cmd === "init") {
    state = Engine.initGame(msg.options || {});
    out({ ok: true, state: Engine.summarize(state) });
    return;
  }

  if (cmd === "state") {
    if (!state) return out({ ok: false, error: "no-game" });
    out({ ok: true, state: Engine.summarize(state) });
    return;
  }

  if (cmd === "legal") {
    if (!state) return out({ ok: false, error: "no-game" });
    out({ ok: true, legal: Engine.legalMoves(state) });
    return;
  }

  if (cmd === "step") {
    if (!state) return out({ ok: false, error: "no-game" });
    const res = Engine.applyAction(state, msg.action || null, msg.options || {});
    state = res.state;
    if (state.phase === "gameover") Engine.finalizeWinner(state);
    out({ ok: res.ok, event: res.event || null, reason: res.reason || null, state: Engine.summarize(state) });
    return;
  }

  if (cmd === "batch") {
    const games = Number(msg.games || 1000);
    const policyA = String(msg.policyA || "dad-slayer");
    const policyB = String(msg.policyB || "baseline");
    out({ ok: true, stats: runBatch(games, policyA, policyB) });
    return;
  }

  out({ ok: false, error: "unknown-cmd" });
});
