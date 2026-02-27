(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies['dadslayer-v1'] = api;
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

  function buildOpponentEvidence(state, playerIndex) {
    const meName = state.players[playerIndex].name;
    const oppName = state.players[(playerIndex + 1) % 2].name;
    const evidence = {};

    let lastAsker = null;
    let lastRank = null;

    const askRe = /^(.+?) asks for (A|10|[2-9JQK])\.$/;
    const giveRe = /^(.+?) gives (\d+) card\(s\)\.$/;
    const fishRe = /^(.+?) says go fish\.$/;
    const bookRe = /^(.+?) books (.+)\.$/;

    for (const line of state.log || []) {
      let m = line.match(askRe);
      if (m) {
        const asker = m[1];
        const rank = m[2];
        lastAsker = asker;
        lastRank = rank;
        evidence[rank] = (evidence[rank] || 0) + (asker === oppName ? 0.9 : -0.05);
        continue;
      }

      m = line.match(giveRe);
      if (m && lastRank && lastAsker) {
        const giver = m[1];
        if (lastAsker === oppName && giver === meName) evidence[lastRank] = (evidence[lastRank] || 0) + 0.7;
        if (lastAsker === meName && giver === oppName) evidence[lastRank] = (evidence[lastRank] || 0) - 0.8;
        continue;
      }

      m = line.match(fishRe);
      if (m && lastRank && lastAsker) {
        const speaker = m[1];
        if (lastAsker === meName && speaker === oppName) evidence[lastRank] = (evidence[lastRank] || 0) - 1.0;
        if (lastAsker === oppName && speaker === meName) evidence[lastRank] = (evidence[lastRank] || 0) + 0.15;
        continue;
      }

      m = line.match(bookRe);
      if (m) {
        const ranks = String(m[2]).split(",").map((s) => s.trim());
        for (const r of ranks) evidence[r] = -3;
      }
    }

    return evidence;
  }

  function pickMove(state, legalActions, playerIndex) {
    if (!Array.isArray(legalActions) || legalActions.length === 0) return null;

    const me = state.players[playerIndex];
    const myCounts = countHand(me.hand);
    const deckPressure = 1 - Math.min(1, (state.deck || []).length / 52);
    const evidence = buildOpponentEvidence(state, playerIndex);

    let best = legalActions[0];
    let bestScore = -Infinity;

    for (const move of legalActions) {
      const rank = move.rank;
      const own = myCounts[rank] || 0;
      const p = estimateOpponentProbability(state, playerIndex, rank);
      const mem = evidence[rank] || 0;

      const nearBook = own >= 2 ? 1 : 0;
      const tripleNow = own >= 3 ? 1 : 0;
      const singleton = own === 1 ? 1 : 0;

      const score =
        own * 1.25 +
        nearBook * 0.95 +
        tripleNow * 1.15 +
        p.probHas * 0.85 +
        p.expectedCount * 0.75 +
        mem * 1.35 +
        deckPressure * (nearBook * 0.25 - singleton * 0.18);

      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }

    return best;
  }

  return { pickMove };
});
