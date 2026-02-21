/* Go Fish Engine (pure state + JSON actions)
 * Works in browser (window.GoFishEngine) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GoFishEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = ["S", "H", "D", "C"];

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function createDeck() {
    const deck = [];
    for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s });
    return deck;
  }

  function shuffle(deck, rand) {
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function counts(hand) {
    const out = {};
    for (const r of RANKS) out[r] = 0;
    for (const c of hand) out[c.rank] += 1;
    return out;
  }

  function removeRank(hand, rank) {
    const keep = [];
    const taken = [];
    for (const c of hand) {
      if (c.rank === rank) taken.push(c); else keep.push(c);
    }
    return { keep, taken };
  }

  function extractBooks(player) {
    const c = counts(player.hand);
    const made = [];
    for (const r of RANKS) {
      if (c[r] === 4 && !player.books.includes(r)) {
        player.books.push(r);
        player.hand = player.hand.filter((x) => x.rank !== r);
        made.push(r);
      }
    }
    player.books.sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b));
    return made;
  }

  function draw(state, playerIndex, n) {
    const p = state.players[playerIndex];
    const amount = Math.min(n, state.deck.length);
    const cards = state.deck.splice(-amount, amount);
    p.hand.push(...cards);
    return cards;
  }

  function maybeRefill(state, playerIndex, refillHand) {
    const p = state.players[playerIndex];
    if (p.hand.length === 0 && state.deck.length > 0) {
      draw(state, playerIndex, Math.min(refillHand, state.deck.length));
    }
  }

  function gameOver(state) {
    return state.players[0].books.length + state.players[1].books.length >= 13;
  }

  function legalMoves(state) {
    if (state.phase !== "play") return [];
    const p = state.players[state.currentPlayer];
    const c = counts(p.hand);
    return RANKS.filter((r) => c[r] > 0).map((rank) => ({ type: "ask_rank", rank }));
  }

  function estimateOpponentProbability(state, askingPlayerIndex, rank) {
    const ai = state.players[askingPlayerIndex];
    const opp = state.players[(askingPlayerIndex + 1) % 2];

    if (ai.books.includes(rank) || opp.books.includes(rank)) {
      return { probHas: 0, expectedCount: 0 };
    }

    const myCount = ai.hand.reduce((n, c) => n + (c.rank === rank ? 1 : 0), 0);
    const unknownCopies = Math.max(0, 4 - myCount);
    const unknownCards = Math.max(1, state.deck.length + opp.hand.length);

    const draws = Math.min(opp.hand.length, unknownCards);
    let probNone = 1;
    for (let i = 0; i < draws; i += 1) {
      const withoutRank = unknownCards - unknownCopies - i;
      const remaining = unknownCards - i;
      if (remaining <= 0) break;
      probNone *= Math.max(0, withoutRank / remaining);
    }

    const probHas = Math.max(0, 1 - probNone);
    const expectedCount = Math.max(0, (unknownCopies * draws) / unknownCards);
    return { probHas, expectedCount };
  }

  function pickMove(state, policy = "random", playerIndex = state.currentPlayer) {
    const legal = legalMoves(state);
    if (!legal.length) return null;

    if (typeof policy === "function") {
      const proposed = policy(state, legal, playerIndex);
      if (proposed && legal.some((a) => a.type === proposed.type && a.rank === proposed.rank)) {
        return proposed;
      }
      return legal[0];
    }

    if (policy === "random") {
      return legal[Math.floor(Math.random() * legal.length)];
    }

    const me = state.players[playerIndex];
    const c = counts(me.hand);

    // Baseline: maximize immediate completion chance.
    if (policy === "baseline") {
      let best = legal[0];
      let bestScore = -Infinity;
      for (const move of legal) {
        const own = c[move.rank] || 0;
        const p = estimateOpponentProbability(state, playerIndex, move.rank);
        const score = own * 1.0 + p.probHas * 0.9 + p.expectedCount * 0.4 + (own >= 3 ? 1.2 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    }

    // DadSlayer (headless policy approximation): book pressure + deny pressure + info gain.
    if (policy === "dadslayer" || policy === "dad-slayer") {
      let best = legal[0];
      let bestScore = -Infinity;

      for (const move of legal) {
        const rank = move.rank;
        const own = c[rank] || 0;
        const p = estimateOpponentProbability(state, playerIndex, rank);
        const nearBook = own >= 3 ? 1.0 : own === 2 ? 0.45 : 0;
        const deny = p.probHas * Math.min(1, own / 3);
        const deckPressure = 1 - Math.min(1, state.deck.length / 52);
        const endgameBoost = deckPressure * (nearBook + deny);

        const score =
          own * 0.45 +
          p.probHas * 1.15 +
          p.expectedCount * 0.65 +
          nearBook * 0.9 +
          deny * 0.7 +
          endgameBoost * 0.5;

        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }

      return best;
    }

    return legal[0];
  }

  function summarize(state) {
    const active = state.players[state.currentPlayer];
    return {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      currentPlayerName: active.name,
      deckCount: state.deck.length,
      players: state.players.map((p) => ({ name: p.name, handCount: p.hand.length, books: [...p.books], handCounts: counts(p.hand) })),
      legalActions: legalMoves(state),
      logTail: state.log.slice(-10),
      winner: state.winner,
    };
  }

  function initGame(opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed : Date.now();
    const rand = mulberry32(seed);
    const startHand = opts.startingHand || 7;

    const state = {
      seed,
      phase: "play",
      currentPlayer: 0,
      winner: null,
      log: [],
      deck: shuffle(createDeck(), rand),
      players: [
        { name: opts.player1Name || "Player 1", hand: [], books: [] },
        { name: opts.player2Name || "Player 2", hand: [], books: [] },
      ],
    };

    for (let i = 0; i < startHand; i += 1) {
      draw(state, 0, 1);
      draw(state, 1, 1);
    }
    extractBooks(state.players[0]);
    extractBooks(state.players[1]);
    return state;
  }

  function applyAction(inputState, action, opts = {}) {
    const state = clone(inputState);
    if (state.phase !== "play") return { state, ok: false, reason: "game-not-play" };
    if (!action || action.type !== "ask_rank") return { state, ok: false, reason: "invalid-action" };

    const rank = action.rank;
    const refillHand = opts.refillHand || 5;
    const cur = state.currentPlayer;
    const opp = (cur + 1) % 2;
    const p = state.players[cur];
    const o = state.players[opp];

    if (!counts(p.hand)[rank]) return { state, ok: false, reason: "illegal-rank" };

    state.log.push(`${p.name} asks for ${rank}.`);
    const removed = removeRank(o.hand, rank);
    o.hand = removed.keep;

    if (removed.taken.length > 0) {
      p.hand.push(...removed.taken);
      state.log.push(`${o.name} gives ${removed.taken.length} card(s).`);
      const books = extractBooks(p);
      if (books.length) state.log.push(`${p.name} books ${books.join(", ")}.`);
      if (gameOver(state)) {
        state.phase = "gameover";
      } else {
        maybeRefill(state, cur, refillHand);
      }
      return { state, ok: true, event: "take" };
    }

    state.log.push(`${o.name} says go fish.`);
    const drawn = draw(state, cur, 1);
    if (drawn.length === 0) {
      state.currentPlayer = opp;
      return { state, ok: true, event: "empty-deck-pass" };
    }

    state.log.push(`${p.name} draws a card.`);
    const books = extractBooks(p);
    if (books.length) state.log.push(`${p.name} books ${books.join(", ")}.`);

    if (gameOver(state)) {
      state.phase = "gameover";
      return { state, ok: true, event: "gameover" };
    }

    if (drawn[0].rank === rank) {
      state.log.push(`${p.name} drew the asked rank and goes again.`);
      maybeRefill(state, cur, refillHand);
      return { state, ok: true, event: "draw-match" };
    }

    state.currentPlayer = opp;
    return { state, ok: true, event: "pass" };
  }

  function finalizeWinner(state) {
    const a = state.players[0].books.length;
    const b = state.players[1].books.length;
    if (a === b) state.winner = "Tie";
    else state.winner = a > b ? state.players[0].name : state.players[1].name;
    return state.winner;
  }

  return { RANKS, initGame, legalMoves, applyAction, summarize, finalizeWinner, pickMove };
});
