const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];
const STARTING_HAND = 7;
const REFILL_HAND = 5;
const MAX_LOG = 12;
const AI_THINK_DELAY = 700;
const AI_DIFFICULTY = "dadslayer";
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
    mode: "human-vs-ai",
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
  appModeSelect: document.getElementById("appModeSelect"),
  tournamentPanel: document.getElementById("tournamentPanel"),
  tableSection: document.getElementById("tableSection"),
  tournamentPolicyA: document.getElementById("tournamentPolicyA"),
  tournamentPolicyB: document.getElementById("tournamentPolicyB"),
  tournamentGames: document.getElementById("tournamentGames"),
  runTournamentBtn: document.getElementById("runTournamentBtn"),
  tournamentStatus: document.getElementById("tournamentStatus"),
  tournamentSummary: document.getElementById("tournamentSummary"),
  barALabel: document.getElementById("barALabel"),
  barBLabel: document.getElementById("barBLabel"),
  barA: document.getElementById("barA"),
  barB: document.getElementById("barB"),
  barAText: document.getElementById("barAText"),
  barBText: document.getElementById("barBText"),
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

function getPolicyNames() {
  return Object.keys(window.GoFishPolicies || {});
}

function prettyPolicyName(name) {
  if (!name) return "Unknown";
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function initPolicySelect() {
  if (!elements.aiDifficultySelect) return;

  const names = getPolicyNames();
  elements.aiDifficultySelect.innerHTML = "";

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = prettyPolicyName(name);
    elements.aiDifficultySelect.appendChild(option);
  }

  if (!names.includes(state.ai.difficulty)) {
    state.ai.difficulty = names.includes("dadslayer") ? "dadslayer" : names[0] || AI_DIFFICULTY;
  }
}

function initTournamentSelectors() {
  const names = getPolicyNames();
  if (!elements.tournamentPolicyA || !elements.tournamentPolicyB) return;

  elements.tournamentPolicyA.innerHTML = "";
  elements.tournamentPolicyB.innerHTML = "";

  for (const name of names) {
    const a = document.createElement("option");
    a.value = name;
    a.textContent = prettyPolicyName(name);
    elements.tournamentPolicyA.appendChild(a);

    const b = document.createElement("option");
    b.value = name;
    b.textContent = prettyPolicyName(name);
    elements.tournamentPolicyB.appendChild(b);
  }

  elements.tournamentPolicyA.value = names.includes("dadslayer") ? "dadslayer" : names[0] || "random";
  elements.tournamentPolicyB.value = names.includes("clawbuddy-v1") ? "clawbuddy-v1" : names[0] || "random";
}

function applyModeUI() {
  const isTournament = state.settings.mode === "ai-tournament";
  if (elements.tournamentPanel) elements.tournamentPanel.hidden = !isTournament;
  if (elements.tableSection) elements.tableSection.hidden = isTournament;
}

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

  const modeText = prettyPolicyName(state.ai.difficulty || AI_DIFFICULTY);
  if (elements.aiModeLabel) {
    elements.aiModeLabel.textContent = modeText;
  }
  if (elements.aiModeStat) {
    elements.aiModeStat.hidden = !aiActive;
  }

  if (elements.aiDifficultySelect) {
    elements.aiDifficultySelect.value = state.ai.difficulty || AI_DIFFICULTY;
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

function updateInferenceForRank(rank, delta, confidenceDelta) {
  if (!state.ai.inference) {
    state.ai.inference = initAiInference();
  }
  const inf = state.ai.inference;
  inf.likelyOpponentHas[rank] = clamp((inf.likelyOpponentHas[rank] || 0) + delta, 0, 1);
  inf.confidence[rank] = clamp((inf.confidence[rank] || 0) + confidenceDelta, 0, 1);
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
  const legalActions = [];
  const aiPlayer = state.players[aiIndex];
  const c = getCounts(aiPlayer.hand);
  for (const rank of RANKS) {
    if (c[rank] > 0) legalActions.push({ type: "ask_rank", rank });
  }
  if (!legalActions.length) return null;

  const policyName = (state.ai.difficulty || AI_DIFFICULTY).toLowerCase();
  const policy = window.GoFishPolicies && window.GoFishPolicies[policyName];

  if (policy && typeof policy.pickMove === "function") {
    const action = policy.pickMove({ state, legalActions, playerIndex: aiIndex, RANKS, getCounts });
    if (action && legalActions.some((m) => m.type === action.type && m.rank === action.rank)) {
      return action.rank;
    }
  }

  return legalActions[0].rank;
}

function resolveTournamentPolicy(name) {
  const policy = window.GoFishPolicies && window.GoFishPolicies[name];
  if (!policy || typeof policy.pickMove !== "function") {
    throw new Error(`Missing policy: ${name}`);
  }
  return policy.pickMove;
}

function updateTournamentBars(aName, bName, aWins, bWins, done) {
  const total = Math.max(1, done);
  const aPct = (aWins / total) * 100;
  const bPct = (bWins / total) * 100;
  if (elements.barALabel) elements.barALabel.textContent = prettyPolicyName(aName);
  if (elements.barBLabel) elements.barBLabel.textContent = prettyPolicyName(bName);
  if (elements.barA) elements.barA.style.width = `${aPct.toFixed(2)}%`;
  if (elements.barB) elements.barB.style.width = `${bPct.toFixed(2)}%`;
  if (elements.barAText) elements.barAText.textContent = `${aPct.toFixed(1)}% (${aWins})`;
  if (elements.barBText) elements.barBText.textContent = `${bPct.toFixed(1)}% (${bWins})`;
}

async function runTournamentFromGui() {
  const games = Math.max(1, Number(elements.tournamentGames?.value || 100));
  const policyAName = elements.tournamentPolicyA?.value || "dadslayer";
  const policyBName = elements.tournamentPolicyB?.value || "clawbuddy-v1";
  const policyA = resolveTournamentPolicy(policyAName);
  const policyB = resolveTournamentPolicy(policyBName);

  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let turnsTotal = 0;

  if (elements.runTournamentBtn) elements.runTournamentBtn.disabled = true;
  if (elements.tournamentStatus) elements.tournamentStatus.textContent = `Running ${games} games...`;

  for (let i = 0; i < games; i += 1) {
    let s = window.GoFishEngine.initGame({ seed: Date.now() + i });
    let turns = 0;

    // Fair seat swap: policyA starts on even games, policyB starts on odd games.
    const aIsP1 = i % 2 === 0;

    while (s.phase === "play" && turns < 10000) {
      const legal = window.GoFishEngine.legalMoves(s);
      if (!legal.length) break;

      const isP1Turn = s.currentPlayer === 0;
      const p = (aIsP1 ? isP1Turn : !isP1Turn) ? policyA : policyB;

      const picked = p(s, legal, s.currentPlayer) || legal[0];
      const move = legal.some((m) => m.type === picked.type && m.rank === picked.rank) ? picked : legal[0];
      const res = window.GoFishEngine.applyAction(s, move);
      s = res.state;
      turns += 1;
    }

    window.GoFishEngine.finalizeWinner(s);
    turnsTotal += turns;

    if (s.winner === "Tie") {
      ties += 1;
    } else {
      const p1Won = s.winner === s.players[0].name;
      const aWon = aIsP1 ? p1Won : !p1Won;
      if (aWon) aWins += 1;
      else bWins += 1;
    }

    if ((i + 1) % 5 === 0 || i === games - 1) {
      updateTournamentBars(policyAName, policyBName, aWins, bWins, i + 1);
      if (elements.tournamentStatus) elements.tournamentStatus.textContent = `Running ${i + 1}/${games} games...`;
      // Let browser paint progress.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const avgTurns = (turnsTotal / games).toFixed(2);
  if (elements.tournamentStatus) elements.tournamentStatus.textContent = `Done. ${games} games complete.`;
  if (elements.tournamentSummary) {
    elements.tournamentSummary.textContent = `${prettyPolicyName(policyAName)} wins: ${aWins}, ${prettyPolicyName(policyBName)} wins: ${bWins}, ties: ${ties}, avg turns: ${avgTurns}.`;
  }
  if (elements.runTournamentBtn) elements.runTournamentBtn.disabled = false;
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
  if (state.settings.mode === "ai-tournament") {
    return;
  }
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
      const mode = prettyPolicyName(state.ai.difficulty || AI_DIFFICULTY);
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
  applyModeUI();
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
    state.ai.difficulty = elements.aiDifficultySelect.value || AI_DIFFICULTY;
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

if (elements.appModeSelect) {
  elements.appModeSelect.addEventListener("change", () => {
    state.settings.mode = elements.appModeSelect.value || "human-vs-ai";
    applyModeUI();
    render();
  });
}

if (elements.runTournamentBtn) {
  elements.runTournamentBtn.addEventListener("click", () => {
    void runTournamentFromGui();
  });
}

// JSON bridge for remote/CLI-style control while keeping GUI intact.
window.GoFishJsonBridge = {
  getState() {
    const active = getActivePlayer();
    return {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      currentPlayerName: active ? active.name : null,
      deckCount: state.deck.length,
      players: state.players.map((p) => ({
        name: p.name,
        handCount: p.hand.length,
        books: [...p.books],
        handCounts: getCounts(p.hand),
      })),
      legalActions:
        state.phase === "play"
          ? RANKS.filter((r) => getCounts(getActivePlayer().hand)[r] > 0).map((rank) => ({ type: "ask_rank", rank }))
          : [],
      winner: state.winner,
      logTail: state.log.slice(-10),
    };
  },
  submit(action) {
    if (!action || action.type !== "ask_rank") {
      return { ok: false, error: "invalid-action" };
    }
    const before = state.currentPlayer;
    handleAsk(action.rank);
    return {
      ok: true,
      currentPlayerBefore: before,
      currentPlayerAfter: state.currentPlayer,
      state: this.getState(),
    };
  },
};

async function bootApp() {
  if (typeof window.__loadPolicies === "function") {
    await window.__loadPolicies();
  }

  initPolicySelect();
  initTournamentSelectors();
  if (elements.appModeSelect) {
    elements.appModeSelect.value = state.settings.mode;
  }
  applyModeUI();
  newGame();
}

void bootApp();
