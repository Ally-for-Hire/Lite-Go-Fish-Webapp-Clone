function countHand(hand) {
  const out = {};
  for (const c of hand || []) {
    out[c.rank] = (out[c.rank] || 0) + 1;
  }
  return out;
}

function estimateOpponentProbability(state, playerIndex, rank) {
  const me = state.players[playerIndex];
  const opp = state.players[(playerIndex + 1) % 2];

  if (me.books.includes(rank) || opp.books.includes(rank)) {
    return { probHas: 0, expectedCount: 0 };
  }

  const myCount = (me.hand || []).reduce((n, c) => n + (c.rank === rank ? 1 : 0), 0);
  const unknownCopies = Math.max(0, 4 - myCount);
  const unknownCards = Math.max(1, (state.deck || []).length + (opp.hand || []).length);
  const draws = Math.min((opp.hand || []).length, unknownCards);

  let probNone = 1;
  for (let i = 0; i < draws; i += 1) {
    const withoutRank = unknownCards - unknownCopies - i;
    const remaining = unknownCards - i;
    if (remaining <= 0) break;
    probNone *= Math.max(0, withoutRank / remaining);
  }

  return {
    probHas: Math.max(0, 1 - probNone),
    expectedCount: Math.max(0, (unknownCopies * draws) / unknownCards),
  };
}

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;

  const me = state.players[playerIndex];
  const counts = countHand(me.hand);
  const deckPressure = 1 - Math.min(1, (state.deck || []).length / 52);

  let best = legalActions[0];
  let bestScore = -Infinity;

  for (const move of legalActions) {
    const rank = move.rank;
    const own = counts[rank] || 0;
    const p = estimateOpponentProbability(state, playerIndex, rank);
    const nearBook = own >= 3 ? 1.0 : own === 2 ? 0.45 : 0;
    const deny = p.probHas * Math.min(1, own / 3);
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

module.exports = { pickMove };
