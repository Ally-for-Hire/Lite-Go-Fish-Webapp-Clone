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

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function loadOpponentFeed(feedPath) {
  if (!fs.existsSync(feedPath)) {
    throw new Error(`Opponent feed missing: ${feedPath}`);
  }

  const lines = fs.readFileSync(feedPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const byGame = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1} in ${feedPath}`);
    }

    if (!entry || !Number.isInteger(entry.game) || !Number.isInteger(entry.turn) || !entry.action) {
      throw new Error(`Feed line ${i + 1} must include integer game, integer turn, and action`);
    }

    if (!byGame.has(entry.game)) byGame.set(entry.game, new Map());
    const turns = byGame.get(entry.game);
    if (turns.has(entry.turn)) {
      throw new Error(`Duplicate feed entry for game=${entry.game} turn=${entry.turn}`);
    }
    turns.set(entry.turn, entry.action);
  }

  return { byGame, totalLines: lines.length };
}

function runTournament({ games, strict, dadslayerPolicy, feed }) {
  const stats = {
    mode: "explicit-step",
    games,
    policyA: "dadslayer",
    policyB: "opponent-feed",
    strict,
    policyAWins: 0,
    policyBWins: 0,
    ties: 0,
    policyAWinRate: 0,
    policyBWinRate: 0,
    tieRate: 0,
    avgTurns: 0,
    feedLinesConsumed: 0,
  };

  let turnsTotal = 0;

  for (let game = 1; game <= games; game += 1) {
    let state = Engine.initGame({ seed: Date.now() + game });
    let turns = 0;
    let opponentTurn = 0;

    while (state.phase === "play" && turns < 10000) {
      const current = state.currentPlayer;
      const legal = Engine.legalMoves(state);
      if (!legal.length) break;

      let action;
      if (current === 0) {
        action = dadslayerPolicy(state, legal, current) || legal[0];
      } else {
        opponentTurn += 1;
        const gameMap = feed.byGame.get(game);
        const proposed = gameMap && gameMap.get(opponentTurn);

        if (!proposed) {
          if (strict) {
            throw new Error(`Missing opponent feed move for game=${game} turn=${opponentTurn}`);
          }
          action = legal[0];
        } else {
          stats.feedLinesConsumed += 1;
          const isLegal = legal.some((m) => m.type === proposed.type && m.rank === proposed.rank);
          if (!isLegal) {
            if (strict) {
              throw new Error(`Illegal opponent move for game=${game} turn=${opponentTurn}: ${JSON.stringify(proposed)}`);
            }
            action = legal[0];
          } else {
            action = proposed;
          }
        }
      }

      const res = Engine.applyAction(state, action);
      state = res.state;
      turns += 1;
    }

    Engine.finalizeWinner(state);
    turnsTotal += turns;

    if (state.winner === "Tie") stats.ties += 1;
    else if (state.winner === state.players[0].name) stats.policyAWins += 1;
    else stats.policyBWins += 1;
  }

  if (strict && stats.feedLinesConsumed !== feed.totalLines) {
    throw new Error(`Unused feed lines detected: consumed=${stats.feedLinesConsumed}, total=${feed.totalLines}`);
  }

  stats.avgTurns = Number((turnsTotal / Math.max(games, 1)).toFixed(2));
  stats.policyAWinRate = Number(((stats.policyAWins / Math.max(games, 1)) * 100).toFixed(2));
  stats.policyBWinRate = Number(((stats.policyBWins / Math.max(games, 1)) * 100).toFixed(2));
  stats.tieRate = Number(((stats.ties / Math.max(games, 1)) * 100).toFixed(2));

  return stats;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const games = Number(process.env.GAMES || 1000);
  const strict = String(process.env.STRICT || "true").toLowerCase() === "true";
  const feedPath = process.env.FEED_PATH || path.join(root, "inputs", "opponent_moves.jsonl");

  const dadPath = path.join(root, "policies", "dadslayer.js");
  const dadslayerPolicy = loadPolicy(dadPath);
  const feed = loadOpponentFeed(feedPath);

  const stats = runTournament({ games, strict, dadslayerPolicy, feed });

  const result = {
    ts: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || "local",
    ref: process.env.GITHUB_REF || "local",
    node: process.version,
    policyA: { name: "dadslayer", path: path.relative(root, dadPath), sha256: sha256File(dadPath) },
    policyB: {
      name: "opponent-feed",
      path: path.relative(root, feedPath),
      sha256: sha256File(feedPath),
      totalLines: feed.totalLines,
      consumedLines: stats.feedLinesConsumed,
    },
    stats,
  };

  const outDir = path.join(root, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "results.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log("Tournament complete: dadslayer vs opponent-feed");
  console.log(`Mode=${stats.mode} | Strict=${stats.strict} | Games=${stats.games} | dadslayer=${stats.policyAWinRate}% | opponent=${stats.policyBWinRate}% | tie=${stats.tieRate}% | avgTurns=${stats.avgTurns}`);
  console.log(`Feed lines: consumed=${stats.feedLinesConsumed} / total=${feed.totalLines}`);
  console.log(`Results: ${outPath}`);
}

main();
