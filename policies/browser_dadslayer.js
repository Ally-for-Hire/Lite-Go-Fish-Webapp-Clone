(function (root) {
  const policy = {
    pickMove(ctx) {
      const legal = ctx.legalActions || [];
      if (!legal.length) return null;

      const state = ctx.state;
      const me = state.players[state.currentPlayer];
      const opp = state.players[(state.currentPlayer + 1) % state.players.length];
      const counts = ctx.getCounts(me.hand);
      const deckPressure = Math.max(0, 1 - state.deck.length / 52);

      let best = legal[0];
      let bestScore = -Infinity;

      for (const move of legal) {
        const rank = move.rank;
        const own = counts[rank] || 0;

        const unknownCopies = Math.max(0, 4 - own - (me.books.includes(rank) || opp.books.includes(rank) ? 4 : 0));
        const unknownCards = Math.max(1, state.deck.length + opp.hand.length);
        const pHas = Math.min(1, (unknownCopies * opp.hand.length) / (unknownCards * unknownCards) * 2.2);

        const nearBook = own >= 3 ? 1.0 : own === 2 ? 0.45 : 0;
        const deny = pHas * Math.min(1, own / 3);
        const expectedTake = pHas * Math.max(1, unknownCopies * 0.5);

        const score =
          own * 0.5 +
          nearBook * 1.0 +
          deny * 0.8 +
          expectedTake * 0.7 +
          deckPressure * (nearBook + deny) * 0.4;

        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }

      return best;
    },
  };

  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.dadslayer = policy;
})(typeof window !== "undefined" ? window : globalThis);
