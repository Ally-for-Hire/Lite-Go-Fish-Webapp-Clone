#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Engine = require("../engine");

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

function runBatch(games, policyAName, policyBName, policyA, policyB) {
  const stats = { games, policyA: policyAName, policyB: policyBName, p1: 0, p2: 0, tie: 0, avgTurns: 0 };
  let turnsTotal = 0;

  for (let i = 0; i < games; i += 1) {
    let state = Engine.initGame({ seed: Date.now() + i });
    let turns = 0;

    while (state.phase === "play" && turns < 10000) {
      const current = state.currentPlayer;
      const move = Engine.pickMove(state, current === 0 ? policyA : policyB, current);
      if (!move) break;
      state = Engine.applyAction(state, move).state;
      turns += 1;
    }

    Engine.finalizeWinner(state);
    turnsTotal += turns;

    if (state.winner === "Tie") stats.tie += 1;
    else if (state.winner === state.players[0].name) stats.p1 += 1;
    else stats.p2 += 1;
  }

  stats.avgTurns = Number((turnsTotal / Math.max(games, 1)).toFixed(2));
  return stats;
}

function runBatchFair(games, policyAName, policyBName, policyA, policyB) {
  const halfAFirst = Math.floor(games / 2);
  const halfBFirst = games - halfAFirst;

  const aAsP1 = runBatch(halfAFirst, policyAName, policyBName, policyA, policyB);
  const bAsP1 = runBatch(halfBFirst, policyBName, policyAName, policyB, policyA);

  const aWins = (aAsP1.p1 || 0) + (bAsP1.p2 || 0);
  const bWins = (aAsP1.p2 || 0) + (bAsP1.p1 || 0);
  const ties = (aAsP1.tie || 0) + (bAsP1.tie || 0);

  const avgTurns = Number((((aAsP1.avgTurns || 0) * halfAFirst + (bAsP1.avgTurns || 0) * halfBFirst) / Math.max(games, 1)).toFixed(2));

  return {
    games,
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

  const alias = (name) => {
    if (name === "dad-slayer") return "dadslayer";
    return name;
  };

  const policyAName = alias(rawPolicyA);
  const policyBName = alias(rawPolicyB);

  const policyPaths = {
    otherai: path.join(root, "policies", "otherai.js"),
    dadslayer: path.join(root, "policies", "dadslayer.js"),
    random: null,
  };

  const policyAPath = policyPaths[policyAName];
  const policyBPath = policyPaths[policyBName];
  if (!(policyAName in policyPaths) || !(policyBName in policyPaths)) {
    throw new Error(`Unknown policy name(s): ${policyAName}, ${policyBName}`);
  }

  const policyA = policyAName === "random" ? "random" : loadPolicy(policyAPath);
  const policyB = policyBName === "random" ? "random" : loadPolicy(policyBPath);

  const stats = runBatchFair(games, policyAName, policyBName, policyA, policyB);
  const result = {
    ts: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || "local",
    ref: process.env.GITHUB_REF || "local",
    node: process.version,
    policyA: policyAName === "random"
      ? { name: policyAName, path: null, sha256: null }
      : { name: policyAName, path: path.relative(root, policyAPath), sha256: fileHash(policyAPath) },
    policyB: policyBName === "random"
      ? { name: policyBName, path: null, sha256: null }
      : { name: policyBName, path: path.relative(root, policyBPath), sha256: fileHash(policyBPath) },
    stats,
  };

  const outDir = path.join(root, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "results.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`Tournament complete: ${policyAName} vs ${policyBName}`);
  console.log(`Games=${stats.games} | ${policyAName}=${stats.policyAWinRate}% | ${policyBName}=${stats.policyBWinRate}% | tie=${stats.tieRate}% | avgTurns=${stats.avgTurns}`);
  console.log(`Results: ${outPath}`);
}

main();
