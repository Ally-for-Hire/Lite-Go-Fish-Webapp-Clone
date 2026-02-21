// Jason's Go Fish AI — "ClawBuddy"
// Adapted for this engine's state + log format.

var ALL_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
var RANK_INDEX = {};
for (var i = 0; i < ALL_RANKS.length; i++) RANK_INDEX[ALL_RANKS[i]] = i;

var TUNING = {
  bookBonus1: 0,
  bookBonus2: 8,
  bookBonus3: 40,
  turnValue: 2,
  missPenalty: 1,
  oppAskBonus: 1.4,
  missRankPenalty: 0.6,
  dominanceGap: 0.12
};

function rankCounts(hand) {
  var out = {};
  for (var i = 0; i < ALL_RANKS.length; i++) out[ALL_RANKS[i]] = 0;
  for (var j = 0; j < (hand || []).length; j++) {
    var card = hand[j];
    if (card && out[card.rank] !== undefined) out[card.rank] += 1;
  }
  return out;
}

function parseEvidence(log, meName, oppName) {
  var oppAskedRanks = {};
  var missRanks = {};
  var bookRanks = {};
  var lastAsk = null;

  var askRe = /^(.+?) asks for (A|10|[2-9JQK])\.$/;
  var giveRe = /^(.+?) gives (\d+) card\(s\)\.$/;
  var fishRe = /^(.+?) says go fish\.$/;
  var bookRe = /^(.+?) books (.+)\.$/;

  for (var i = 0; i < (log || []).length; i++) {
    var line = log[i];
    if (typeof line !== 'string') continue;

    var m = line.match(askRe);
    if (m) {
      lastAsk = { asker: m[1], rank: m[2] };
      if (m[1] === oppName) oppAskedRanks[m[2]] = true;
      continue;
    }

    m = line.match(giveRe);
    if (m && lastAsk) {
      var giver = m[1];
      if (lastAsk.asker === meName && giver === oppName) {
        // Fresh direct evidence opponent does have/had this rank now.
        delete missRanks[lastAsk.rank];
      }
      continue;
    }

    m = line.match(fishRe);
    if (m && lastAsk) {
      var speaker = m[1];
      if (lastAsk.asker === meName && speaker === oppName) {
        // We asked this rank and were denied.
        missRanks[lastAsk.rank] = true;
      }
      continue;
    }

    m = line.match(bookRe);
    if (m) {
      var ranks = String(m[2]).split(',');
      for (var j = 0; j < ranks.length; j++) {
        var r = ranks[j].trim();
        if (r) {
          bookRanks[r] = true;
          delete oppAskedRanks[r];
          delete missRanks[r];
        }
      }
    }
  }

  return { oppAskedRanks: oppAskedRanks, missRanks: missRanks, bookRanks: bookRanks };
}

function getBookBonus(myCount) {
  if (myCount >= 3) return TUNING.bookBonus3;
  if (myCount === 2) return TUNING.bookBonus2;
  if (myCount === 1) return TUNING.bookBonus1;
  return 0;
}

function hasVisibleOppHand(oppHand) {
  if (!Array.isArray(oppHand)) return false;
  if (oppHand.length === 0) return true;
  return !!(oppHand[0] && typeof oppHand[0].rank === 'string');
}

function hypergeometricAtLeast1(totalUnknown, successCards, draws) {
  if (successCards <= 0 || draws <= 0 || totalUnknown <= 0) return 0;
  if (successCards >= totalUnknown) return 1;
  if (draws > totalUnknown - successCards) return 1;

  var pZero = 1;
  var maxDraws = Math.min(draws, totalUnknown);
  for (var i = 0; i < maxDraws; i++) {
    var num = totalUnknown - successCards - i;
    var den = totalUnknown - i;
    if (num <= 0) return 1;
    pZero *= num / den;
  }
  return 1 - pZero;
}

function estimateChance(rank, myCount, oppHandSize, deckSize, booked, missRank, oppVisibleCount) {
  if (booked) return { p: 0, expectedCards: 0, rawP: 0 };

  if (typeof oppVisibleCount === 'number') {
    return {
      p: oppVisibleCount > 0 ? 1 : 0,
      expectedCards: Math.max(0, oppVisibleCount),
      rawP: oppVisibleCount > 0 ? 1 : 0
    };
  }

  var remaining = Math.max(0, 4 - myCount);
  var totalUnknown = Math.max(1, deckSize + oppHandSize);
  var rawP = hypergeometricAtLeast1(totalUnknown, remaining, oppHandSize);
  var p = rawP;
  if (p > 0.01 && p < 0.99) p *= 0.85;
  if (missRank) p *= 0.5;
  var expectedCards = p * Math.max(1, remaining * (oppHandSize / Math.max(1, totalUnknown)));

  return { p: p, expectedCards: expectedCards, rawP: rawP };
}

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  if (legalActions.length === 1) return legalActions[0];

  var me = state.players[playerIndex];
  var oppIndex = (playerIndex + 1) % 2;
  var opp = state.players[oppIndex];
  var myCounts = rankCounts(me.hand || []);
  var oppCounts = rankCounts(opp.hand || []);
  var useVisibleOppHand = hasVisibleOppHand(opp.hand);
  var oppHandSize = (opp.hand || []).length;
  var deckSize = (state.deck || []).length;

  var evidence = parseEvidence(state.log || [], me.name, opp.name);
  var allBooked = {};
  for (var i = 0; i < (me.books || []).length; i++) allBooked[me.books[i]] = true;
  for (var j = 0; j < (opp.books || []).length; j++) allBooked[opp.books[j]] = true;
  for (var k = 0; k < ALL_RANKS.length; k++) {
    var rank = ALL_RANKS[k];
    if (evidence.bookRanks[rank]) allBooked[rank] = true;
  }

  var scored = [];
  var highestProb = null;

  for (var idx = 0; idx < legalActions.length; idx++) {
    var action = legalActions[idx];
    var r = action.rank;
    var myCount = myCounts[r] || 0;
    var est = estimateChance(
      r,
      myCount,
      oppHandSize,
      deckSize,
      !!allBooked[r],
      !!evidence.missRanks[r],
      useVisibleOppHand ? (oppCounts[r] || 0) : undefined
    );

    var bookBonus = getBookBonus(myCount);
    var q = est.p * (est.expectedCards + bookBonus + TUNING.turnValue) - (1 - est.p) * TUNING.missPenalty;

    if (evidence.oppAskedRanks[r]) q *= TUNING.oppAskBonus;
    if (evidence.missRanks[r] && !useVisibleOppHand) q *= TUNING.missRankPenalty;

    var row = {
      action: action,
      score: q,
      p: est.p,
      rawP: est.rawP,
      myCount: myCount,
      immediateBook: myCount >= 3
    };
    scored.push(row);

    if (!highestProb || row.p > highestProb.p || (row.p === highestProb.p && row.myCount > highestProb.myCount)) {
      highestProb = row;
    }
  }

  scored.sort(function(a, b) {
    if (a.rawP >= 0.99 && b.rawP < 0.99) return -1;
    if (b.rawP >= 0.99 && a.rawP < 0.99) return 1;
    if (a.rawP >= 0.99 && b.rawP >= 0.99 && a.myCount !== b.myCount) return b.myCount - a.myCount;
    if (b.score !== a.score) return b.score - a.score;
    if (b.myCount !== a.myCount) return b.myCount - a.myCount;
    return (RANK_INDEX[a.action.rank] || 0) - (RANK_INDEX[b.action.rank] || 0);
  });

  var chosen = scored[0];
  if (highestProb && !chosen.immediateBook && highestProb.p > chosen.p + TUNING.dominanceGap) {
    chosen = highestProb;
  }

  var choice = chosen.action;
  for (var t = 0; t < legalActions.length; t++) {
    var legal = legalActions[t];
    if (legal.type === choice.type && legal.rank === choice.rank) return choice;
  }
  return legalActions[0];
}

(function registerPolicy(root) {
  var api = { pickMove: pickMove };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.otherai = api;
})(typeof self !== "undefined" ? self : this);
