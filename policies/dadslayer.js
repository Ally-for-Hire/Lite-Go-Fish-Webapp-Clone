(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.dadslayer = api;
})(typeof self !== "undefined" ? self : this, function () {
  function countHand(hand) {
    const out = {};
    for (const c of hand || []) out[c.rank] = (out[c.rank] || 0) + 1;
    return out;
  }

  function estimateOpponentProbability(state, playerIndex, rank) {
    const me = state.players[playerIndex];
    const opp = state.players[(playerIndex + 1) % 2];

    if (me.books.includes(rank) || opp.books.includes(rank)) return { probHas: 0, expectedCount: 0 };

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
    const opp = state.players[(playerIndex + 1) % 2];
    const myCounts = countHand(me.hand);
    const oppCounts = countHand(opp.hand);

    let best = legalActions[0];
    let bestScore = -Infinity;

    for (const move of legalActions) {
      const rank = move.rank;
      const own = myCounts[rank] || 0;
      const oppHas = oppCounts[rank] || 0;

      // In current engine policy API, full state is visible.
      // Maximize immediate capture from opponent, then maximize book conversion.
      const immediateTake = oppHas;
      const postTake = own + oppHas;
      const completesBook = postTake >= 4 ? 1 : 0;
      const nearBook = postTake === 3 ? 1 : postTake === 2 ? 0.4 : 0;

      const score =
        immediateTake * 10 +
        completesBook * 6 +
        nearBook * 2 +
        own * 0.5;

      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }

    return best;
  }

  return { pickMove };
});
