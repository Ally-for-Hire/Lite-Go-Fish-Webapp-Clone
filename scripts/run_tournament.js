#!/usr/bin/env node
const path = require("path");
const Engine = require("../engine");
const crypto = require("crypto");
const fs = require("fs");

function loadPolicy(filePath) {
  const mod = require(filePath);
  const fn = typeof mod === "function" ? mod : mod && mod.pickMove;
  if (typeof fn !== "function") {
    throw new Error(`Policy at ${filePath} must export pickMove(state, legalActions, playerIndex)`);
  }
  return fn;
}

function fileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function resolvePolicy(name, policyPaths) {
  if (name === "random") return "random";
  const p = policyPaths[name];
  if (!p) throw new Error(`Unknown policy name: ${name}`);
  return loadPolicy(p);
}

function chooseAction(state, policyFnOrRandom, playerIndex) {
  const legal = Engine.legalMoves(state);
  if (!legal.length) return null;

  if (policyFnOrRandom === "random") {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const action = policyFnOrRandom(state, legal, playerIndex) || legal[0];
  if (!legal.some((a) => a.type === action.type && a.rank === action.rank)) {
    return legal[0];
  }

  return action;
}

function runSingleGame(seed, policyP1, policyP2) {
  let state = Engine.initGame({ seed });
  let turns = 0;

  while (state.phase === "play" && turns < 10000) {
    const current = state.currentPlayer;
    const action = chooseAction(state, current === 0 ? policyP1 : policyP2, current);
    if (!action) break;

    // Explicit submission-like stepping: exactly one action applied per loop.
    const res = Engine.applyAction(state, action);
    state = res.state;
    turns += 1;
  }

  Engine.finalizeWinner(state);
  return { state, turns };
}

function runBatch(games, p1Name, p2Name, p1Policy, p2Policy) {
  const out = { games, p1Name, p2Name, p1Wins: 0, p2Wins: 0, ties: 0, avgTurns: 0 };
  let turnsTotal = 0;

  for (let i = 0; i < games; i += 1) {
    const { state, turns } = runSingleGame(Date.now() + i, p1Policy, p2Policy);
    turnsTotal += turns;

    if (state.winner === "Tie") out.ties += 1;
    else if (state.winner === state.players[0].name) out.p1Wins += 1;
    else out.p2Wins += 1;
  }

  out.avgTurns = Number((turnsTotal / Math.max(games, 1)).toFixed(2));
  return out;
}

function runBatchFair(games, policyAName, policyBName, policyA, policyB) {
  const halfAFirst = Math.floor(games / 2);
  const halfBFirst = games - halfAFirst;

  const aAsP1 = runBatch(halfAFirst, policyAName, policyBName, policyA, policyB);
  const bAsP1 = runBatch(halfBFirst, policyBName, policyAName, policyB, policyA);

  const aWins = aAsP1.p1Wins + bAsP1.p2Wins;
  const bWins = aAsP1.p2Wins + bAsP1.p1Wins;
  const ties = aAsP1.ties + bAsP1.ties;
  const avgTurns = Number((((aAsP1.avgTurns || 0) * halfAFirst + (bAsP1.avgTurns || 0) * halfBFirst) / Math.max(games, 1)).toFixed(2));

  return {
    games,
    mode: "explicit-step",
    policyA: policyAName,
    policyB: policyBName,
    fair: true,
    policyAWins: aWins,
    policyBWins: bWins,
    ties,
    policyAWinRate: Number(((aWins / Math.max(games, 1)) * 100).toFixed(2)),
    policyBWinRate: Number(((bWins / Math.max(games, 1)) * 100).toFixed(2)),
    tieRate: Number(((ties / Math.max(games, 1)) * 100).toFixed(2)),
    avgTurns,
    breakdown: { aAsP1, bAsP1 },
  };
}

function main() {
  const root = path.resolve(__dirname, "..");
  const games = Number(process.env.GAMES || process.argv[2] || 1000);
  const rawPolicyA = process.env.POLICY_A || "random";
  const rawPolicyB = process.env.POLICY_B || "dadslayer";

  const alias = (name) => (name === "dad-slayer" ? "dadslayer" : name);
  const policyAName = alias(rawPolicyA);
  const policyBName = alias(rawPolicyB);

  const policyPaths = {
    otherai: path.join(root, "policies", "otherai.js"),
    dadslayer: path.join(root, "policies", "dadslayer.js"),
    random: null,
  };

  const policyA = resolvePolicy(policyAName, policyPaths);
  const policyB = resolvePolicy(policyBName, policyPaths);

  const stats = runBatchFair(games, policyAName, policyBName, policyA, policyB);

  const result = {
    ts: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || "local",
    ref: process.env.GITHUB_REF || "local",
    node: process.version,
    policyA: policyAName === "random" ? { name: policyAName, path: null, sha256: null } : { name: policyAName, path: path.relative(root, policyPaths[policyAName]), sha256: fileHash(policyPaths[policyAName]) },
    policyB: policyBName === "random" ? { name: policyBName, path: null, sha256: null } : { name: policyBName, path: path.relative(root, policyPaths[policyBName]), sha256: fileHash(policyPaths[policyBName]) },
    stats,
  };

  const outDir = path.join(root, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "results.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`Tournament complete: ${policyAName} vs ${policyBName}`);
  console.log(`Mode=${stats.mode} | Games=${stats.games} | ${policyAName}=${stats.policyAWinRate}% | ${policyBName}=${stats.policyBWinRate}% | tie=${stats.tieRate}% | avgTurns=${stats.avgTurns}`);
  console.log(`Results: ${outPath}`);
}

main();
