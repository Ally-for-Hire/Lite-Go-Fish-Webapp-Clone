const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];
const STARTING_HAND = 7;
const REFILL_HAND = 5;
const MAX_LOG = 12;
const AI_THINK_DELAY = 700;
const AI_DIFFICULTY = "dad-slayer";
const CLAUDE_MOVE_TIMEOUT_MS = 900;

const state = {
  players: [],
  deck: [],
  currentPlayer: 0,
  phase: "handoff",
  log: [],
  winner: null,
  settings: {
    aiEnabled: true,
  },
  ai: {
    playerIndex: 1,
    pendingAction: false,
    tick: 0,
    timerId: null,
    memory: null,
    difficulty: AI_DIFFICULTY,
    inference: null,
    claude: {
      enabled: false,
      timeoutMs: CLAUDE_MOVE_TIMEOUT_MS,
      mode: "assist", // "assist" => fallback to local; "only" => no fallback
    },
  },
};

const elements = {
  deckCount: document.getElementById("deckCount"),
  turnLabel: document.getElementById("turnLabel"),
  booksTotal: document.getElementById("booksTotal"),
  aiModeStat: document.getElementById("aiModeStat"),
  aiModeLabel: document.getElementById("aiModeLabel"),
  askButtons: document.getElementById("askButtons"),
  statusText: document.getElementById("statusText"),
  logList: document.getElementById("logList"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayHeading: document.getElementById("overlayHeading"),
  overlayMessage: document.getElementById("overlayMessage"),
  overlayAction: document.getElementById("overlayActionBtn"),
  rulesPanel: document.getElementById("rulesPanel"),
  toggleRulesBtn: document.getElementById("toggleRulesBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  opponentAiBtn: document.getElementById("opponentAiBtn"),
  opponentHumanBtn: document.getElementById("opponentHumanBtn"),
  aiDifficultySelect: document.getElementById("aiDifficultySelect"),
  player1Name: document.getElementById("player1Name"),
  player2Name: document.getElementById("player2Name"),
  players: [
    {
      panel: document.getElementById("player1Panel"),
      badge: document.getElementById("player1Badge"),
      cards: document.getElementById("player1Cards"),
      booksCount: document.getElementById("player1BooksCount"),
      books: document.getElementById("player1Books"),
    },
    {
      panel: document.getElementById("player2Panel"),
      badge: document.getElementById("player2Badge"),
      cards: document.getElementById("player2Cards"),
      booksCount: document.getElementById("player2BooksCount"),
      books: document.getElementById("player2Books"),
    },
  ],
};

function createRankMap(value) {
  const map = {};
  for (const rank of RANKS) {
    map[rank] = value;
  }
  return map;
}

function initAiMemory() {
  return {
    lastOpponentAsk: createRankMap(null),
    lastOpponentSuccess: createRankMap(null),
    lastAIGoFish: createRankMap(null),
    lastAITook: createRankMap(null),
  };
}

function initAiInference() {
  return {
    likelyOpponentHas: createRankMap(0),
    confidence: createRankMap(0),
    particles: [],
  };
}

function getDifficultyWeights() {
  const mode = state.ai.difficulty || "normal";
  if (mode === "easy") {
    return {
      completion: 0.28,
      nearBook: 0.08,
      deny: 0.08,
      info: 0.34,
      memory: 0.1,
      lookahead: 0.12,
      monteCarlo: 0.06,
      infoValue: 0.04,
      temperature: 0.42,
    };
  }
  if (mode === "hard") {
    return {
      completion: 0.34,
      nearBook: 0.15,
      deny: 0.14,
      info: 0.1,
      memory: 0.08,
      lookahead: 0.12,
      monteCarlo: 0.14,
      infoValue: 0.07,
      temperature: 0.2,
    };
  }
  if (mode === "dad-slayer") {
    return {
      completion: 0.31,
      nearBook: 0.17,
      deny: 0.15,
      info: 0.07,
      memory: 0.07,
      lookahead: 0.12,
      monteCarlo: 0.2,
      infoValue: 0.09,
      temperature: 0.12,
    };
  }
  return {
    completion: 0.33,
    nearBook: 0.14,
    deny: 0.12,
    info: 0.16,
    memory: 0.1,
    lookahead: 0.15,
    monteCarlo: 0.1,
    infoValue: 0.06,
    temperature: 0.28,
  };
}

function resetAiState() {
  if (state.ai.timerId) {
    clearTimeout(state.ai.timerId);
  }
  state.ai.pendingAction = false;
  state.ai.tick = 0;
  state.ai.timerId = null;
  state.ai.memory = initAiMemory();
  state.ai.inference = initAiInference();
}

function isAiEnabled() {
  return state.settings.aiEnabled;
}

function isAiPlayer(index) {
  return isAiEnabled() && index === state.ai.playerIndex;
}

function getOpponentIndex(index) {
  return (index + 1) % state.players.length;
}

function updatePlayerNames() {
  const opponentName = isAiEnabled() ? "AI" : "Player 2";
  state.players[0].name = "Player 1";
  state.players[1].name = opponentName;
  elements.player1Name.textContent = state.players[0].name;
  elements.player2Name.textContent = state.players[1].name;
  const aiActive = isAiEnabled();
  elements.opponentAiBtn.classList.toggle("active", aiActive);
  elements.opponentAiBtn.setAttribute("aria-pressed", aiActive ? "true" : "false");
  elements.opponentHumanBtn.classList.toggle("active", !aiActive);
  elements.opponentHumanBtn.setAttribute("aria-pressed", !aiActive ? "true" : "false");

  const modeText = (state.ai.difficulty || "normal").replace(/-/g, " ");
  if (elements.aiModeLabel) {
    elements.aiModeLabel.textContent = modeText.replace(/\b\w/g, (m) => m.toUpperCase());
  }
  if (elements.aiModeStat) {
    elements.aiModeStat.hidden = !aiActive;
  }

  if (elements.aiDifficultySelect) {
    elements.aiDifficultySelect.value = state.ai.difficulty || "normal";
    elements.aiDifficultySelect.disabled = !aiActive;
  }
}

function createPlayers() {
  return [
    { name: "Player 1", hand: [], books: [] },
    { name: "Player 2", hand: [], books: [] },
  ];
}

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function drawFromDeck(count) {
  const drawCount = Math.min(count, state.deck.length);
  if (drawCount <= 0) {
    return [];
  }
  return state.deck.splice(-drawCount, drawCount);
}

function drawForPlayer(player, count) {
  const drawn = drawFromDeck(count);
  player.hand.push(...drawn);
  return drawn;
}

function refillIfEmpty(player) {
  if (player.hand.length > 0 || state.deck.length === 0) {
    return;
  }
  const drawn = drawForPlayer(player, Math.min(REFILL_HAND, state.deck.length));
  addLog(`${player.name} draws ${drawn.length} card(s) to refill.`);
  logBooks(player, checkForBooks(player));
}

function dealInitialHands() {
  for (let i = 0; i < STARTING_HAND; i += 1) {
    for (const player of state.players) {
      drawForPlayer(player, 1);
    }
  }
  for (const player of state.players) {
    const books = checkForBooks(player);
    logBooks(player, books);
  }
}

function getCounts(hand) {
  const counts = {};
  for (const rank of RANKS) {
    counts[rank] = 0;
  }
  for (const card of hand) {
    counts[card.rank] += 1;
  }
  return counts;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function binaryEntropy(probability) {
  if (probability <= 0 || probability >= 1) {
    return 0;
  }
  return -(probability * Math.log2(probability) + (1 - probability) * Math.log2(1 - probability));
}

function getRemainingCopies(rank, aiIndex, aiCounts) {
  const aiPlayer = state.players[aiIndex];
  const opponent = state.players[getOpponentIndex(aiIndex)];
  if (aiPlayer.books.includes(rank) || opponent.books.includes(rank)) {
    return 0;
  }
  return Math.max(0, 4 - aiCounts[rank]);
}

function estimateOpponentProbability(rank, aiIndex, aiCounts, opponentHandSize) {
  const unknownCopies = getRemainingCopies(rank, aiIndex, aiCounts);
  const totalUnknownCards = state.deck.length + opponentHandSize;
  if (unknownCopies <= 0 || opponentHandSize <= 0 || totalUnknownCards <= 0) {
    return {
      probHas: 0,
      expectedCount: 0,
      unknownCopies,
      totalUnknownCards,
    };
  }

  const cappedCopies = Math.min(unknownCopies, totalUnknownCards);
  let probNone = 1;
  for (let i = 0; i < opponentHandSize; i += 1) {
    const remaining = totalUnknownCards - i;
    const withoutRank = totalUnknownCards - cappedCopies - i;
    probNone *= clamp(withoutRank / remaining, 0, 1);
  }
  const probHas = clamp(1 - probNone, 0, 1);
  const expectedCount = (cappedCopies * opponentHandSize) / totalUnknownCards;
  return {
    probHas,
    expectedCount,
    unknownCopies: cappedCopies,
    totalUnknownCards,
  };
}

function ageFrom(lastTick) {
  if (lastTick === null) {
    return null;
  }
  return Math.max(0, state.ai.tick - lastTick);
}

function decay(base, age, rate) {
  return Math.max(0, base - age * rate);
}

function memoryBias(rank) {
  const memory = state.ai.memory;
  let bias = 0;
  const askAge = ageFrom(memory.lastOpponentAsk[rank]);
  if (askAge !== null) {
    bias += decay(0.22, askAge, 0.04);
  }
  const successAge = ageFrom(memory.lastOpponentSuccess[rank]);
  if (successAge !== null) {
    bias += decay(0.32, successAge, 0.05);
  }
  const missAge = ageFrom(memory.lastAIGoFish[rank]);
  if (missAge !== null) {
    bias -= decay(0.28, missAge, 0.05);
  }
  const tookAge = ageFrom(memory.lastAITook[rank]);
  if (tookAge !== null) {
    bias -= decay(0.2, tookAge, 0.04);
  }
  return bias;
}

function updateInferenceForRank(rank, delta, confidenceDelta) {
  if (!state.ai.inference) {
    state.ai.inference = initAiInference();
  }
  const inf = state.ai.inference;
  inf.likelyOpponentHas[rank] = clamp((inf.likelyOpponentHas[rank] || 0) + delta, 0, 1);
  inf.confidence[rank] = clamp((inf.confidence[rank] || 0) + confidenceDelta, 0, 1);
}

function inferenceBias(rank) {
  if (!state.ai.inference) {
    return 0;
  }
  const inf = state.ai.inference;
  const likely = inf.likelyOpponentHas[rank] || 0;
  const conf = inf.confidence[rank] || 0;
  return (likely - 0.5) * conf * 0.8;
}

function decayInference() {
  if (!state.ai.inference) {
    return;
  }
  for (const rank of RANKS) {
    state.ai.inference.likelyOpponentHas[rank] *= 0.985;
    state.ai.inference.confidence[rank] *= 0.975;
  }
}

function bumpAiTick() {
  if (!isAiEnabled()) {
    return null;
  }
  state.ai.tick += 1;
  decayInference();
  return state.ai.tick;
}

function handHasRank(hand, rank) {
  return hand.some((card) => card.rank === rank);
}

function takeCardsByRank(hand, rank) {
  const taken = [];
  for (let i = hand.length - 1; i >= 0; i -= 1) {
    if (hand[i].rank === rank) {
      taken.push(hand.splice(i, 1)[0]);
    }
  }
  return taken;
}

function checkForBooks(player) {
  const counts = getCounts(player.hand);
  const newBooks = [];
  for (const rank of RANKS) {
    if (counts[rank] === 4 && !player.books.includes(rank)) {
      newBooks.push(rank);
    }
  }
  if (newBooks.length > 0) {
    player.hand = player.hand.filter((card) => !newBooks.includes(card.rank));
    player.books.push(...newBooks);
  }
  return newBooks;
}

function totalBooks() {
  return state.players.reduce((sum, player) => sum + player.books.length, 0);
}

function addLog(message) {
  state.log.unshift(message);
  if (state.log.length > MAX_LOG) {
    state.log.pop();
  }
}

function logBooks(player, books) {
  if (!books.length) {
    return;
  }
  if (isAiEnabled()) {
    for (const rank of books) {
      state.ai.memory.lastOpponentAsk[rank] = null;
      state.ai.memory.lastOpponentSuccess[rank] = null;
      state.ai.memory.lastAIGoFish[rank] = null;
      state.ai.memory.lastAITook[rank] = null;
      updateInferenceForRank(rank, -1, 0.5);
    }
  }
  if (books.length === 1) {
    addLog(`${player.name} books ${books[0]}.`);
    return;
  }
  addLog(`${player.name} books ${books.join(", ")}.`);
}

function getActivePlayer() {
  return state.players[state.currentPlayer];
}

function getOpponent() {
  return state.players[(state.currentPlayer + 1) % state.players.length];
}

function newGame() {
  state.players = createPlayers();
  updatePlayerNames();
  resetAiState();
  state.deck = shuffle(createDeck());
  state.currentPlayer = 0;
  state.phase = "handoff";
  state.log = [];
  state.winner = null;
  addLog("New game started. Player 1 begins.");
  dealInitialHands();
  render();
}

function beginPlay() {
  if (state.phase === "gameover") {
    newGame();
    return;
  }

  state.phase = "play";
  const player = getActivePlayer();

  refillIfEmpty(player);
  if (checkGameOver()) {
    return;
  }

  if (player.hand.length === 0 && state.deck.length === 0) {
    if (state.players.every((p) => p.hand.length === 0)) {
      endGame();
      return;
    }
    addLog(`${player.name} has no cards and skips the turn.`);
    advanceTurn();
    return;
  }

  render();
}

function advanceTurn() {
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.phase = "handoff";
  render();
}

function endGame() {
  state.phase = "gameover";
  state.winner = determineWinner();
  render();
}

function determineWinner() {
  const [player1, player2] = state.players;
  if (player1.books.length > player2.books.length) {
    return player1.name;
  }
  if (player2.books.length > player1.books.length) {
    return player2.name;
  }
  return "Tie";
}

function checkGameOver() {
  if (totalBooks() >= RANKS.length) {
    endGame();
    return true;
  }
  return false;
}

function updateAiMemoryForAsk(askerIndex, rank, takenCount, tick) {
  if (!isAiEnabled()) {
    return;
  }

  const aiIndex = state.ai.playerIndex;
  if (askerIndex === aiIndex) {
    if (takenCount > 0) {
      state.ai.memory.lastAITook[rank] = tick;
      updateInferenceForRank(rank, -0.6, 0.4);
    } else {
      state.ai.memory.lastAIGoFish[rank] = tick;
      updateInferenceForRank(rank, -0.3, 0.3);
    }
    return;
  }

  if (askerIndex === getOpponentIndex(aiIndex)) {
    state.ai.memory.lastOpponentAsk[rank] = tick;
    updateInferenceForRank(rank, 0.35, 0.25);
    if (takenCount > 0) {
      state.ai.memory.lastOpponentSuccess[rank] = tick;
      updateInferenceForRank(rank, 0.35, 0.3);
    }
  }
}

function estimateOpponentPressure(rank) {
  const memory = state.ai.memory;
  let pressure = 0;

  const askAge = ageFrom(memory.lastOpponentAsk[rank]);
  if (askAge !== null) {
    pressure += decay(0.35, askAge, 0.06);
  }

  const successAge = ageFrom(memory.lastOpponentSuccess[rank]);
  if (successAge !== null) {
    pressure += decay(0.45, successAge, 0.07);
  }

  pressure += Math.max(0, inferenceBias(rank));

  return clamp(pressure, 0, 1);
}

function getAiStyle(deckPressure, aiCounts) {
  let strongestPair = 0;
  let nearBooks = 0;
  for (const rank of RANKS) {
    strongestPair = Math.max(strongestPair, aiCounts[rank]);
    if (aiCounts[rank] >= 3) {
      nearBooks += 1;
    }
  }

  if (nearBooks > 0 || deckPressure < 0.25 || strongestPair >= 3) {
    return "greedy";
  }
  if (deckPressure > 0.6) {
    return "deny";
  }
  return "balanced";
}

function lookaheadValue(rank, ownCount, adjustedProb, expectedTake, deckPressure) {
  const hitBookChance = clamp((ownCount + expectedTake) / 4, 0, 1);
  const missPenalty = clamp(0.2 + deckPressure * 0.35, 0, 1);
  const bonusTurnValue = adjustedProb * clamp(0.5 + ownCount * 0.12, 0, 1);

  return hitBookChance * 0.55 + bonusTurnValue * 0.35 - (1 - adjustedProb) * missPenalty * 0.3;
}

function createZeroCounts() {
  const counts = {};
  for (const rank of RANKS) {
    counts[rank] = 0;
  }
  return counts;
}

function knownUnavailableCounts(aiIndex) {
  const result = createZeroCounts();
  const aiPlayer = state.players[aiIndex];
  const oppPlayer = state.players[getOpponentIndex(aiIndex)];

  for (const card of aiPlayer.hand) {
    result[card.rank] += 1;
  }

  for (const rank of aiPlayer.books) {
    result[rank] = 4;
  }
  for (const rank of oppPlayer.books) {
    result[rank] = 4;
  }

  return result;
}

function rankEntropyFromProbability(prob) {
  return binaryEntropy(clamp(prob, 0, 1));
}

function normalizeParticles(aiIndex, aiCounts, opponentHandSize) {
  const inf = state.ai.inference || initAiInference();
  const particles = [];
  const sampleCount = state.ai.difficulty === "dad-slayer" ? 300 : 140;
  const knownUnavailable = knownUnavailableCounts(aiIndex);

  for (let i = 0; i < sampleCount; i += 1) {
    const opp = createZeroCounts();
    let remaining = opponentHandSize;

    for (const rank of RANKS) {
      const aiPlayer = state.players[aiIndex];
      const oppPlayer = state.players[getOpponentIndex(aiIndex)];
      if (aiPlayer.books.includes(rank) || oppPlayer.books.includes(rank)) {
        continue;
      }

      const maxCopies = Math.max(0, 4 - (knownUnavailable[rank] || 0));
      const likely = clamp((inf.likelyOpponentHas[rank] || 0) + 0.15, 0, 1);
      const conf = clamp(inf.confidence[rank] || 0, 0, 1);
      const target = Math.round(maxCopies * likely * (0.35 + conf * 0.65));
      const noise = Math.floor(Math.random() * 2);
      const value = clamp(target + noise - 1, 0, Math.min(maxCopies, remaining));
      opp[rank] = value;
      remaining -= value;
    }

    while (remaining > 0) {
      const candidates = RANKS.filter((rank) => {
        const aiPlayer = state.players[aiIndex];
        const oppPlayer = state.players[getOpponentIndex(aiIndex)];
        if (aiPlayer.books.includes(rank) || oppPlayer.books.includes(rank)) {
          return false;
        }
        return opp[rank] < Math.max(0, 4 - (knownUnavailable[rank] || 0));
      });
      if (candidates.length === 0) {
        break;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      opp[pick] += 1;
      remaining -= 1;
    }

    particles.push(opp);
  }

  inf.particles = particles;
  state.ai.inference = inf;
}

function particleEstimate(rank) {
  const inf = state.ai.inference;
  if (!inf || !Array.isArray(inf.particles) || inf.particles.length === 0) {
    return { probHas: 0, expectedCount: 0 };
  }

  let has = 0;
  let total = 0;
  for (const particle of inf.particles) {
    const value = particle[rank] || 0;
    if (value > 0) {
      has += 1;
    }
    total += value;
  }

  return {
    probHas: has / inf.particles.length,
    expectedCount: total / inf.particles.length,
  };
}

function applyBooksOnCounts(counts) {
  let books = 0;
  for (const rank of RANKS) {
    if (counts[rank] >= 4) {
      books += 1;
      counts[rank] = 0;
    }
  }
  return books;
}

function cloneCounts(counts) {
  return { ...counts };
}

function evaluateAbstractState(s) {
  const aiCards = RANKS.reduce((sum, r) => sum + s.aiCounts[r], 0);
  const opCards = RANKS.reduce((sum, r) => sum + s.opCounts[r], 0);
  return (s.aiBooks - s.opBooks) * 4 + (aiCards - opCards) * 0.15;
}

function minimaxEndgame(stateNode, actor, depth, alpha, beta) {
  const aiTurn = actor === "ai";
  if (depth <= 0 || stateNode.deck <= 0) {
    return evaluateAbstractState(stateNode);
  }

  const actorCounts = aiTurn ? stateNode.aiCounts : stateNode.opCounts;
  const oppCounts = aiTurn ? stateNode.opCounts : stateNode.aiCounts;
  const choices = RANKS.filter((rank) => actorCounts[rank] > 0);
  if (choices.length === 0) {
    return evaluateAbstractState(stateNode);
  }

  let best = aiTurn ? -Infinity : Infinity;

  for (const rank of choices) {
    const next = {
      aiCounts: cloneCounts(stateNode.aiCounts),
      opCounts: cloneCounts(stateNode.opCounts),
      aiBooks: stateNode.aiBooks,
      opBooks: stateNode.opBooks,
      deck: stateNode.deck,
    };

    const mine = aiTurn ? next.aiCounts : next.opCounts;
    const theirs = aiTurn ? next.opCounts : next.aiCounts;
    const taken = theirs[rank] || 0;

    if (taken > 0) {
      mine[rank] += taken;
      theirs[rank] = 0;
      if (aiTurn) {
        next.aiBooks += applyBooksOnCounts(next.aiCounts);
      } else {
        next.opBooks += applyBooksOnCounts(next.opCounts);
      }

      const v = minimaxEndgame(next, actor, depth - 1, alpha, beta);
      if (aiTurn) {
        best = Math.max(best, v);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, best);
      }
    } else {
      if (next.deck > 0) {
        next.deck -= 1;
      }
      const v = minimaxEndgame(next, aiTurn ? "op" : "ai", depth - 1, alpha, beta);
      if (aiTurn) {
        best = Math.max(best, v);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, best);
      }
    }

    if (beta <= alpha) {
      break;
    }
  }

  return best;
}

function endgameRankScore(rank, aiCounts, opCounts, deckSize) {
  const root = {
    aiCounts: cloneCounts(aiCounts),
    opCounts: cloneCounts(opCounts),
    aiBooks: state.players[state.ai.playerIndex].books.length,
    opBooks: state.players[getOpponentIndex(state.ai.playerIndex)].books.length,
    deck: deckSize,
  };

  if ((root.opCounts[rank] || 0) > 0) {
    root.aiCounts[rank] += root.opCounts[rank];
    root.opCounts[rank] = 0;
    root.aiBooks += applyBooksOnCounts(root.aiCounts);
    return minimaxEndgame(root, "ai", 3, -Infinity, Infinity);
  }

  if (root.deck > 0) {
    root.deck -= 1;
  }
  return minimaxEndgame(root, "op", 3, -Infinity, Infinity);
}

function monteCarloRankEV(rank, aiCounts, deckSize) {
  const inf = state.ai.inference;
  if (!inf || !Array.isArray(inf.particles) || inf.particles.length === 0) {
    return 0;
  }

  const rollouts = state.ai.difficulty === "dad-slayer" ? 80 : 40;
  let total = 0;

  for (let i = 0; i < rollouts; i += 1) {
    const particle = inf.particles[Math.floor(Math.random() * inf.particles.length)];
    const opCounts = cloneCounts(particle);
    const mine = cloneCounts(aiCounts);

    const taken = opCounts[rank] || 0;
    let score = 0;

    if (taken > 0) {
      mine[rank] += taken;
      opCounts[rank] = 0;
      const booksMade = applyBooksOnCounts(mine);
      score += taken * 0.6 + booksMade * 2.4;
    } else {
      score -= 0.25;
      if (deckSize > 0) {
        score += 0.08;
      }
      const oppBest = Math.max(...RANKS.map((r) => opCounts[r] || 0));
      score -= oppBest * 0.15;
    }

    total += score;
  }

  return total / rollouts;
}

function informationValueScore(rank, fusedProb) {
  const priorEntropy = rankEntropyFromProbability(fusedProb);
  const posteriorIfHit = rankEntropyFromProbability(0.95);
  const posteriorIfMiss = rankEntropyFromProbability(0.05);
  const expectedPosterior = fusedProb * posteriorIfHit + (1 - fusedProb) * posteriorIfMiss;
  return Math.max(0, priorEntropy - expectedPosterior);
}

function softmaxPick(candidates, temperature) {
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1 || temperature <= 0.0001) {
    return candidates[0].rank;
  }

  const top = Math.max(...candidates.map((c) => c.score));
  const scaled = candidates.map((c) => ({
    rank: c.rank,
    value: Math.exp((c.score - top) / temperature),
  }));

  const sum = scaled.reduce((s, x) => s + x.value, 0);
  let roll = Math.random() * Math.max(sum, 0.0001);

  for (const item of scaled) {
    roll -= item.value;
    if (roll <= 0) {
      return item.rank;
    }
  }

  return scaled[scaled.length - 1].rank;
}

function buildClaudeStateSnapshot(aiIndex) {
  const aiPlayer = state.players[aiIndex];
  const opponentIndex = getOpponentIndex(aiIndex);
  const opponent = state.players[opponentIndex];
  const aiCounts = getCounts(aiPlayer.hand);

  return {
    schemaVersion: 1,
    game: {
      deckCount: state.deck.length,
      aiBooks: [...aiPlayer.books],
      opponentBooks: [...opponent.books],
      opponentHandSize: opponent.hand.length,
      aiHandCounts: aiCounts,
      ranks: [...RANKS],
    },
    inference: {
      likelyOpponentHas: { ...state.ai.inference.likelyOpponentHas },
      confidence: { ...state.ai.inference.confidence },
    },
    memory: {
      lastOpponentAsk: { ...state.ai.memory.lastOpponentAsk },
      lastOpponentSuccess: { ...state.ai.memory.lastOpponentSuccess },
      lastAIGoFish: { ...state.ai.memory.lastAIGoFish },
      lastAITook: { ...state.ai.memory.lastAITook },
    },
    legalActions: RANKS.filter((r) => aiCounts[r] > 0).map((rank) => ({ type: "ask_rank", rank })),
  };
}

function validateClaudeMoveAction(action, legalRanks) {
  if (!action || action.type !== "ask_rank") {
    return null;
  }
  if (!legalRanks.includes(action.rank)) {
    return null;
  }
  return action.rank;
}

async function getClaudeMove(aiIndex) {
  const provider = window.claudePolicy;
  const cfg = state.ai.claude || {};
  if (!cfg.enabled || !provider || typeof provider.getMove !== "function") {
    return null;
  }

  const snapshot = buildClaudeStateSnapshot(aiIndex);
  const legalRanks = snapshot.legalActions.map((a) => a.rank);
  if (legalRanks.length === 0) {
    return null;
  }

  const timeoutMs = Math.max(100, cfg.timeoutMs || CLAUDE_MOVE_TIMEOUT_MS);
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));

  try {
    const action = await Promise.race([provider.getMove(snapshot), timeoutPromise]);
    return validateClaudeMoveAction(action, legalRanks);
  } catch (err) {
    console.warn("Claude move provider failed:", err);
    return null;
  }
}

function chooseAiRank() {
  const aiIndex = state.ai.playerIndex;
  const aiPlayer = state.players[aiIndex];
  const counts = getCounts(aiPlayer.hand);
  const available = RANKS.filter((rank) => counts[rank] > 0);
  if (available.length === 0) {
    return null;
  }

  const opponentIndex = getOpponentIndex(aiIndex);
  const opponentHandSize = state.players[opponentIndex].hand.length;
  const deckPressure = clamp(state.deck.length / 52, 0, 1);
  const style = getAiStyle(deckPressure, counts);
  const w = getDifficultyWeights();

  normalizeParticles(aiIndex, counts, opponentHandSize);
  const endgame = state.deck.length <= 10 || opponentHandSize <= 4;

  let bestRank = available[0];
  let bestScore = -Infinity;
  const candidates = [];

  for (const rank of available) {
    const ownCount = counts[rank];
    const base = estimateOpponentProbability(rank, aiIndex, counts, opponentHandSize);
    const particle = particleEstimate(rank);
    const fusedProb = clamp(base.probHas * 0.5 + particle.probHas * 0.5, 0, 1);
    const fusedExpected = Math.max(base.expectedCount * 0.45 + particle.expectedCount * 0.55, 0);
    const bias = memoryBias(rank) + inferenceBias(rank);
    const adjustedProb = clamp(fusedProb + bias, 0, 1);

    const expectedTake = adjustedProb * Math.max(1, fusedExpected);
    const completionNow = ownCount + expectedTake;
    const completionScore = clamp(completionNow / 4, 0, 1);

    const nearBookBonus = ownCount >= 3 ? 1 : ownCount === 2 ? 0.45 : 0;
    const denyScore = estimateOpponentPressure(rank) * clamp(ownCount / 3, 0, 1);
    const infoScore = binaryEntropy(adjustedProb);
    const memoryScore = clamp(0.5 + bias, 0, 1);
    const lookaheadScore = lookaheadValue(rank, ownCount, adjustedProb, expectedTake, deckPressure);
    const monteCarloScore = monteCarloRankEV(rank, counts, state.deck.length);
    const infoValue = informationValueScore(rank, fusedProb);

    let endgameScore = 0;
    if (endgame) {
      const opCounts = createZeroCounts();
      for (const r of RANKS) {
        opCounts[r] = Math.round(particleEstimate(r).expectedCount);
      }
      endgameScore = endgameRankScore(rank, counts, opCounts, state.deck.length);
    }

    let styleCompletion = 1;
    let styleDeny = 1;
    let styleInfo = 1;

    if (style === "greedy") {
      styleCompletion = 1.18;
      styleDeny = 0.9;
      styleInfo = 0.82;
    } else if (style === "deny") {
      styleCompletion = 0.92;
      styleDeny = 1.22;
      styleInfo = 1.05;
    }

    const score =
      completionScore * w.completion * styleCompletion +
      nearBookBonus * w.nearBook +
      denyScore * w.deny * styleDeny +
      infoScore * w.info * styleInfo +
      memoryScore * w.memory +
      lookaheadScore * w.lookahead +
      monteCarloScore * w.monteCarlo +
      infoValue * w.infoValue +
      (endgame ? endgameScore * 0.02 : 0);

    candidates.push({ rank, score });

    if (score > bestScore) {
      bestScore = score;
      bestRank = rank;
      continue;
    }

    if (score === bestScore) {
      if (ownCount > counts[bestRank]) {
        bestRank = rank;
        continue;
      }
      const denyA = estimateOpponentPressure(rank);
      const denyB = estimateOpponentPressure(bestRank);
      if (denyA > denyB) {
        bestRank = rank;
      }
    }
  }

  const nearOptimal = candidates.filter((c) => c.score >= bestScore - 0.08);
  const picked = softmaxPick(nearOptimal, w.temperature);
  return picked || bestRank;
}

async function aiTakeTurn() {
  if (!isAiEnabled() || !isAiPlayer(state.currentPlayer) || state.phase !== "play") {
    return;
  }

  const aiIndex = state.ai.playerIndex;
  const player = getActivePlayer();
  if (player.hand.length === 0) {
    advanceTurn();
    return;
  }

  // AI uses only public info (its hand, books, opponent hand size, and observed asks).
  let rank = await getClaudeMove(aiIndex);
  if (!rank) {
    const mode = (state.ai.claude && state.ai.claude.mode) || "assist";
    if (mode === "only") {
      return;
    }
    rank = chooseAiRank();
  }

  if (!rank) {
    return;
  }

  if (!isAiEnabled() || !isAiPlayer(state.currentPlayer) || state.phase !== "play") {
    return;
  }

  handleAsk(rank);
}

// Optional Claude policy adapter contract:
// window.claudePolicy = {
//   getMove: async (snapshot) => ({ type: "ask_rank", rank: "7" })
// };
//
// snapshot has:
// - game.aiHandCounts / game.opponentHandSize / books / deckCount
// - inference + memory maps
// - legalActions[]

function scheduleAiAction() {
  if (!isAiEnabled() || state.phase === "gameover" || !isAiPlayer(state.currentPlayer)) {
    return;
  }
  if (state.ai.pendingAction) {
    return;
  }

  state.ai.pendingAction = true;
  const delay = AI_THINK_DELAY + Math.floor(Math.random() * 350);
  state.ai.timerId = setTimeout(() => {
    state.ai.pendingAction = false;
    state.ai.timerId = null;
    if (state.phase === "handoff") {
      beginPlay();
      return;
    }
    if (state.phase === "play") {
      void aiTakeTurn();
    }
  }, delay);
}

function handleAsk(rank) {
  if (state.phase !== "play") {
    return;
  }

  const player = getActivePlayer();
  if (!handHasRank(player.hand, rank)) {
    return;
  }

  const askTick = bumpAiTick();
  const askerIndex = state.currentPlayer;
  const opponent = getOpponent();
  addLog(`${player.name} asks for ${rank}.`);

  const taken = takeCardsByRank(opponent.hand, rank);
  updateAiMemoryForAsk(askerIndex, rank, taken.length, askTick);
  if (taken.length > 0) {
    player.hand.push(...taken);
    addLog(`${opponent.name} gives ${taken.length} card(s).`);
    logBooks(player, checkForBooks(player));
    if (checkGameOver()) {
      return;
    }
    refillIfEmpty(player);
    if (checkGameOver()) {
      return;
    }
    if (player.hand.length === 0 && state.deck.length === 0) {
      addLog(`${player.name} has no cards and the deck is empty. Turn passes.`);
      advanceTurn();
      return;
    }
    render();
    return;
  }

  addLog(`${opponent.name} says go fish.`);
  const drawn = drawForPlayer(player, 1);
  if (drawn.length === 0) {
    addLog("The deck is empty.");
    advanceTurn();
    return;
  }

  addLog(`${player.name} draws a card.`);
  const matched = drawn[0].rank === rank;
  logBooks(player, checkForBooks(player));

  if (checkGameOver()) {
    return;
  }

  if (matched) {
    addLog(`${player.name} drew the asked rank and goes again.`);
    refillIfEmpty(player);
    if (checkGameOver()) {
      return;
    }
    if (player.hand.length === 0 && state.deck.length === 0) {
      addLog(`${player.name} has no cards and the deck is empty. Turn passes.`);
      advanceTurn();
      return;
    }
    render();
    return;
  }

  advanceTurn();
}

function renderPlayerPanel(index) {
  const panel = elements.players[index];
  const player = state.players[index];
  const isActive = state.phase === "play" && index === state.currentPlayer;

  panel.panel.classList.toggle("active", isActive);
  panel.badge.classList.toggle("active", isActive);
  panel.badge.textContent = isActive ? "Active" : "Stand by";
  panel.cards.textContent = player.hand.length;
  panel.booksCount.textContent = player.books.length;

  renderBooks(panel.books, player);
}

function renderBooks(target, player) {
  target.innerHTML = "";
  if (player.books.length === 0) {
    const message = document.createElement("div");
    message.className = "hand-message";
    message.textContent = "No books yet.";
    target.appendChild(message);
    return;
  }

  for (const rank of player.books) {
    const chip = document.createElement("span");
    chip.className = "book-chip";
    chip.textContent = rank;
    target.appendChild(chip);
  }
}

function renderAskButtons() {
  elements.askButtons.innerHTML = "";

  if (state.phase !== "play") {
    const message = document.createElement("div");
    message.className = "hand-message";
    message.textContent = "Waiting for the next turn.";
    elements.askButtons.appendChild(message);
    return;
  }

  if (isAiPlayer(state.currentPlayer)) {
    const message = document.createElement("div");
    message.className = "hand-message";
    message.textContent = "AI is choosing a rank.";
    elements.askButtons.appendChild(message);
    return;
  }

  const player = getActivePlayer();
  const counts = getCounts(player.hand);
  const available = RANKS.filter((rank) => counts[rank] > 0);

  if (available.length === 0) {
    const message = document.createElement("div");
    message.className = "hand-message";
    message.textContent = "No cards in hand.";
    elements.askButtons.appendChild(message);
    return;
  }

  for (const rank of available) {
    const button = document.createElement("button");
    button.className = "rank-button";
    button.type = "button";
    button.dataset.rank = rank;

    const rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = rank;

    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = `x${counts[rank]}`;

    button.append(rankSpan, countSpan);
    elements.askButtons.appendChild(button);
  }
}

function renderStatus() {
  if (state.phase === "play") {
    if (isAiPlayer(state.currentPlayer)) {
      const mode = (state.ai.difficulty || "normal").replace(/-/g, " ");
      elements.statusText.textContent = `AI (${mode}) is thinking.`;
      return;
    }
    const player = getActivePlayer();
    elements.statusText.textContent = `${player.name}, click a rank in your hand.`;
    return;
  }
  if (state.phase === "gameover") {
    elements.statusText.textContent = "Game over. Review the final books.";
    return;
  }
  if (isAiPlayer(state.currentPlayer)) {
    elements.statusText.textContent = "AI is preparing a move.";
    return;
  }
  const player = getActivePlayer();
  elements.statusText.textContent = `Waiting for ${player.name} to take the seat.`;
}

function renderLog() {
  elements.logList.innerHTML = "";
  if (state.log.length === 0) {
    const item = document.createElement("li");
    item.className = "log-entry";
    item.textContent = "No moves yet.";
    elements.logList.appendChild(item);
    return;
  }
  for (const entry of state.log) {
    const item = document.createElement("li");
    item.className = "log-entry";
    item.textContent = entry;
    elements.logList.appendChild(item);
  }
}

function renderOverlay() {
  elements.overlayAction.hidden = false;
  if (state.phase === "handoff") {
    if (isAiPlayer(state.currentPlayer)) {
      elements.overlay.classList.remove("is-visible");
      elements.overlay.setAttribute("aria-hidden", "true");
      return;
    }
    const player = getActivePlayer();
    elements.overlayTitle.textContent = "Pass the screen";
    elements.overlayHeading.textContent = `${player.name}, your turn`;
    elements.overlayMessage.textContent =
      "Only you should look at the screen. Click when you are ready.";
    elements.overlayAction.textContent = "I am ready";
    elements.overlay.classList.add("is-visible");
    elements.overlay.setAttribute("aria-hidden", "false");
    return;
  }

  if (state.phase === "gameover") {
    const [player1, player2] = state.players;
    const winner = state.winner === "Tie" ? "It is a tie." : `${state.winner} wins.`;
    elements.overlayTitle.textContent = "Game over";
    elements.overlayHeading.textContent = winner;
    elements.overlayMessage.textContent = `${player1.name} ${player1.books.length} - ${player2.books.length} ${player2.name}`;
    elements.overlayAction.textContent = "Play again";
    elements.overlay.classList.add("is-visible");
    elements.overlay.setAttribute("aria-hidden", "false");
    return;
  }

  elements.overlay.classList.remove("is-visible");
  elements.overlay.setAttribute("aria-hidden", "true");
}

function render() {
  const player = getActivePlayer();
  elements.deckCount.textContent = state.deck.length;
  elements.turnLabel.textContent = state.phase === "gameover" ? "Game over" : player.name;
  elements.booksTotal.textContent = `${totalBooks()} / ${RANKS.length}`;

  renderPlayerPanel(0);
  renderPlayerPanel(1);
  renderAskButtons();
  renderStatus();
  renderLog();
  renderOverlay();
  scheduleAiAction();
}

elements.askButtons.addEventListener("click", (event) => {
  if (isAiPlayer(state.currentPlayer)) {
    return;
  }
  const button = event.target.closest("button[data-rank]");
  if (!button) {
    return;
  }
  handleAsk(button.dataset.rank);
});

elements.overlayAction.addEventListener("click", () => {
  beginPlay();
});

elements.newGameBtn.addEventListener("click", () => {
  newGame();
});

elements.opponentAiBtn.addEventListener("click", () => {
  if (state.settings.aiEnabled) {
    return;
  }
  state.settings.aiEnabled = true;
  newGame();
});

elements.opponentHumanBtn.addEventListener("click", () => {
  if (!state.settings.aiEnabled) {
    return;
  }
  state.settings.aiEnabled = false;
  newGame();
});

if (elements.aiDifficultySelect) {
  elements.aiDifficultySelect.addEventListener("change", () => {
    state.ai.difficulty = elements.aiDifficultySelect.value || "normal";
    if (state.settings.aiEnabled) {
      newGame();
    } else {
      render();
    }
  });
}

elements.toggleRulesBtn.addEventListener("click", () => {
  elements.rulesPanel.hidden = !elements.rulesPanel.hidden;
});

newGame();
