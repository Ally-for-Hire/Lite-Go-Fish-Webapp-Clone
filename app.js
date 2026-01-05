const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];
const STARTING_HAND = 7;
const REFILL_HAND = 5;
const MAX_LOG = 12;
const AI_THINK_DELAY = 700;

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
  },
};

const elements = {
  deckCount: document.getElementById("deckCount"),
  turnLabel: document.getElementById("turnLabel"),
  booksTotal: document.getElementById("booksTotal"),
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

function resetAiState() {
  if (state.ai.timerId) {
    clearTimeout(state.ai.timerId);
  }
  state.ai.pendingAction = false;
  state.ai.tick = 0;
  state.ai.timerId = null;
  state.ai.memory = initAiMemory();
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

function bumpAiTick() {
  if (!isAiEnabled()) {
    return null;
  }
  state.ai.tick += 1;
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
    } else {
      state.ai.memory.lastAIGoFish[rank] = tick;
    }
    return;
  }

  if (askerIndex === getOpponentIndex(aiIndex)) {
    state.ai.memory.lastOpponentAsk[rank] = tick;
    if (takenCount > 0) {
      state.ai.memory.lastOpponentSuccess[rank] = tick;
    }
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

  let bestRank = available[0];
  let bestScore = -Infinity;

  for (const rank of available) {
    const base = estimateOpponentProbability(rank, aiIndex, counts, opponentHandSize);
    const bias = memoryBias(rank);
    const adjustedProb = clamp(base.probHas + bias, 0, 1);
    const entropy = binaryEntropy(adjustedProb);
    const expectedNormalized =
      base.unknownCopies === 0 ? 0 : base.expectedCount / base.unknownCopies;
    const memoryScore = clamp(0.5 + bias, 0, 1);
    const greedyScore = counts[rank] / 4;

    const score =
      expectedNormalized * 0.55 + entropy * 0.25 + memoryScore * 0.12 + greedyScore * 0.08;

    if (score > bestScore) {
      bestScore = score;
      bestRank = rank;
      continue;
    }
    if (score === bestScore && counts[rank] > counts[bestRank]) {
      bestRank = rank;
    }
  }

  return bestRank;
}

function aiTakeTurn() {
  if (!isAiEnabled() || !isAiPlayer(state.currentPlayer) || state.phase !== "play") {
    return;
  }

  const player = getActivePlayer();
  if (player.hand.length === 0) {
    advanceTurn();
    return;
  }

  // AI uses only public info (its hand, books, opponent hand size, and observed asks).
  const rank = chooseAiRank();
  if (!rank) {
    return;
  }
  handleAsk(rank);
}

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
      aiTakeTurn();
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
      elements.statusText.textContent = "AI is thinking.";
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

elements.toggleRulesBtn.addEventListener("click", () => {
  elements.rulesPanel.hidden = !elements.rulesPanel.hidden;
});

newGame();
