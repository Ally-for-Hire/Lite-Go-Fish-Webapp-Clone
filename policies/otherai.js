// Jason's Go Fish AI — "ClawBuddy"
// Strategy: count-based scoring + log-parsed beliefs + calibrated probabilities

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  if (legalActions.length === 1) return legalActions[0];

  var me = state.players[playerIndex];
  var oppIndex = (playerIndex + 1) % 2;
  var opp = state.players[oppIndex];
  var myHand = me.hand || [];
  var myBooks = me.books || [];
  var oppBooks = opp.books || [];
  var oppHandSize = (opp.hand || []).length;
  var deckSize = (state.deck || []).length;
  var log = state.log || [];

  // Count how many of each rank we hold
  var myRankCounts = {};
  for (var i = 0; i < myHand.length; i++) {
    var r = myHand[i].rank;
    myRankCounts[r] = (myRankCounts[r] || 0) + 1;
  }

  // Parse log for opponent behavior signals
  var oppAskedRanks = {};   // ranks opponent asked for (they likely hold these)
  var oppGoFished = {};     // ranks we asked and missed (opponent doesn't have)
  var weGotCards = {};      // ranks where we successfully got cards

  for (var i = 0; i < log.length; i++) {
    var entry = log[i];
    if (typeof entry !== 'string') continue;

    // Detect opponent asks: "Player 2 asks for 7s" or similar patterns
    var oppAskMatch = entry.match(/Player\s*(\d+)\s*ask/i);
    if (oppAskMatch) {
      var askingPlayer = parseInt(oppAskMatch[1], 10) - 1; // 1-indexed to 0-indexed
      if (askingPlayer === oppIndex) {
        // Extract rank from the log entry
        var rankMatch = entry.match(/(?:asks?\s+(?:for\s+)?)?(\d+|[AJQK]|10)s?\b/i);
        if (rankMatch) {
          oppAskedRanks[rankMatch[1].toUpperCase()] = true;
        }
      }
    }

    // Detect "Go Fish" responses to our asks
    if (entry.match(/go\s*fish/i)) {
      var askRankMatch = entry.match(/(\d+|[AJQK]|10)/i);
      if (askRankMatch) {
        oppGoFished[askRankMatch[1].toUpperCase()] = true;
      }
    }
  }

  // All 13 ranks and which are booked
  var allBooked = {};
  for (var i = 0; i < myBooks.length; i++) allBooked[myBooks[i]] = true;
  for (var i = 0; i < oppBooks.length; i++) allBooked[oppBooks[i]] = true;

  // Estimate probability opponent has each rank
  // Total unknown cards = 52 - cards in our hand - 4*booked ranks - deck
  var bookedCount = Object.keys(allBooked).length;
  var knownCards = myHand.length + (bookedCount * 4) + deckSize;
  var unknownInOppHand = oppHandSize; // cards opponent holds that we can't see

  // Count unbooked ranks (potential targets)
  var unbookedRanks = 0;
  var ALL_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  for (var i = 0; i < ALL_RANKS.length; i++) {
    if (!allBooked[ALL_RANKS[i]]) unbookedRanks++;
  }

  // Score each legal action
  var scored = [];
  for (var i = 0; i < legalActions.length; i++) {
    var action = legalActions[i];
    var rank = action.rank;
    var myCount = myRankCounts[rank] || 0;

    // Base probability: how likely does opponent have this rank?
    // Cards of this rank unaccounted for = 4 - myCount - (4 if booked)
    var remaining = allBooked[rank] ? 0 : (4 - myCount);
    // Some are in deck, some in opponent hand
    // Rough estimate: P = 1 - (1 - remaining/totalUnknown)^oppHandSize
    var totalUnknown = remaining + deckSize; // simplification
    var p;
    if (remaining <= 0 || oppHandSize <= 0) {
      p = 0;
    } else if (totalUnknown <= 0) {
      p = 0;
    } else {
      // Hypergeometric-ish: probability at least 1 of 'remaining' cards is in oppHandSize draws
      var pMiss = 1;
      for (var k = 0; k < oppHandSize && k < 20; k++) {
        var poolLeft = totalUnknown - k;
        if (poolLeft <= 0) break;
        pMiss *= Math.max(0, (poolLeft - remaining)) / poolLeft;
      }
      p = 1 - pMiss;
    }

    // Deflate uncertain probabilities (calibration from extensive testing)
    if (p > 0.01 && p < 0.99) {
      p *= 0.85;
    }

    // Book proximity weight — the core of our scoring
    var bookWeight;
    if (myCount >= 3) {
      bookWeight = 20;  // one card from completing a book — extremely valuable
    } else if (myCount >= 2) {
      bookWeight = 5;   // getting close
    } else {
      bookWeight = 1;   // no book proximity
    }

    // Opponent asked bonus — if they asked for this rank, they likely have it
    var oppBonus = oppAskedRanks[rank] ? 1.4 : 1.0;

    // Penalize ranks we recently go-fished on (opponent probably doesn't have them)
    var goFishPenalty = oppGoFished[rank] ? 0.5 : 1.0;

    var score = p * bookWeight * oppBonus * goFishPenalty;

    scored.push({
      action: action,
      score: score,
      p: p,
      myCount: myCount
    });
  }

  // Sort: certain hits first (p~1 sorted by book proximity), then by score
  scored.sort(function(a, b) {
    if (a.p >= 0.99 && b.p < 0.99) return -1;
    if (b.p >= 0.99 && a.p < 0.99) return 1;
    if (a.p >= 0.99 && b.p >= 0.99) return b.myCount - a.myCount;
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break: higher own count, then rank order
    if (b.myCount !== a.myCount) return b.myCount - a.myCount;
    return a.action.rank.localeCompare(b.action.rank);
  });

  // Validate chosen action is legal
  var choice = scored[0].action;
  var isLegal = legalActions.some(function(a) {
    return a.type === choice.type && a.rank === choice.rank;
  });
  return isLegal ? choice : legalActions[0];
}

(function registerPolicy(root) {
  var api = { pickMove: pickMove };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.otherai = api;
})(typeof self !== "undefined" ? self : this);
