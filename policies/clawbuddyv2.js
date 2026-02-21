// Jason's Go Fish AI — "ClawBuddy" v2
// Ported from ~/code/gofish analytical strategy + belief tracker
// Adapted for Zac's engine stateless pickMove interface

var ALL_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// === BELIEF RECONSTRUCTION FROM LOG ===
// Our engine tracks beliefs event-by-event. Here we rebuild that from the log.

function reconstructBeliefs(log, meName, oppName, myHand, myBooks, oppBooks) {
  // Per-rank state: what we know about opponent's holdings
  var rankState = {};  // rank → { state: 'unknown'|'has'|'absent', drawsSinceAbsent: number }
  for (var i = 0; i < ALL_RANKS.length; i++) {
    rankState[ALL_RANKS[i]] = { state: 'unknown', drawsSinceAbsent: 0 };
  }

  var oppAskedRanks = {};  // ranks opponent asked for

  var askRe = /^(.+?) asks for (A|10|[2-9JQK])\.$/;
  var giveRe = /^(.+?) gives (\d+) card\(s\)\.$/;
  var fishRe = /^(.+?) says go fish\.$/;
  var drawRe = /^(.+?) draws a card\.$/;
  var bookRe = /^(.+?) books (.+)\.$/;
  var lastAsk = null;

  for (var i = 0; i < log.length; i++) {
    var line = log[i];
    if (typeof line !== 'string') continue;

    var m = line.match(askRe);
    if (m) {
      var asker = m[1];
      var rank = m[2];
      lastAsk = { asker: asker, rank: rank };

      if (asker === oppName) {
        // Opponent asked for this rank — they definitely have at least one
        rankState[rank] = { state: 'has', drawsSinceAbsent: 0 };
        oppAskedRanks[rank] = true;
      }
      // If we asked for it, we'll find out the result in the next log entries
      continue;
    }

    m = line.match(giveRe);
    if (m && lastAsk) {
      var giver = m[1];
      if (lastAsk.asker === meName && giver === oppName) {
        // We asked, opponent gave us cards — they had it (now they might not)
        // After giving all cards of that rank, they're absent
        rankState[lastAsk.rank] = { state: 'absent', drawsSinceAbsent: 0 };
      }
      if (lastAsk.asker === oppName && giver === meName) {
        // Opponent asked us and we gave — they still have that rank (plus more now)
        rankState[lastAsk.rank] = { state: 'has', drawsSinceAbsent: 0 };
      }
      continue;
    }

    m = line.match(fishRe);
    if (m && lastAsk) {
      var speaker = m[1];
      if (lastAsk.asker === meName && speaker === oppName) {
        // We asked, opponent said go fish — they DON'T have this rank
        rankState[lastAsk.rank] = { state: 'absent', drawsSinceAbsent: 0 };
      }
      if (lastAsk.asker === oppName && speaker === meName) {
        // Opponent asked us and we said go fish — they still have the rank
        // (they must hold it to ask), state stays 'has'
      }
      continue;
    }

    m = line.match(drawRe);
    if (m) {
      var drawer = m[1];
      if (drawer === oppName) {
        // Opponent drew a card — absent ranks might now be in their hand
        for (var r in rankState) {
          if (rankState[r].state === 'absent') {
            rankState[r].drawsSinceAbsent++;
          }
        }
      }
      continue;
    }

    m = line.match(bookRe);
    if (m) {
      var ranks = m[2].split(',');
      for (var j = 0; j < ranks.length; j++) {
        var br = ranks[j].trim();
        if (br && rankState[br]) {
          rankState[br] = { state: 'absent', drawsSinceAbsent: 0 };
        }
      }
    }
  }

  // Mark booked ranks
  var booked = {};
  for (var i = 0; i < myBooks.length; i++) booked[myBooks[i]] = true;
  for (var i = 0; i < oppBooks.length; i++) booked[oppBooks[i]] = true;

  return { rankState: rankState, oppAskedRanks: oppAskedRanks, booked: booked };
}

// === PROBABILITY ESTIMATION ===
// Mirrors our BeliefTracker.getProbability() logic

function estimateProbability(rank, myCount, beliefs, oppHandSize, deckSize) {
  if (beliefs.booked[rank]) return 0;

  var rs = beliefs.rankState[rank];
  if (!rs) return 0;

  // Definite states
  if (rs.state === 'has') return 1.0;
  if (rs.state === 'absent' && rs.drawsSinceAbsent === 0) return 0.0;

  // Unknown or absent-with-draws: hypergeometric estimate
  var remaining = Math.max(0, 4 - myCount);
  if (remaining === 0) return 0;

  var totalUnknown = Math.max(1, deckSize + oppHandSize);

  // If absent with draws, adjust: only the drawn cards could contain this rank
  var effectiveDraws = oppHandSize;
  if (rs.state === 'absent') {
    // Only cards drawn since denial could have this rank
    effectiveDraws = Math.min(oppHandSize, rs.drawsSinceAbsent);
  }

  if (effectiveDraws <= 0) return 0;

  var pMiss = 1;
  for (var k = 0; k < effectiveDraws; k++) {
    var poolLeft = totalUnknown - k;
    if (poolLeft <= 0) break;
    pMiss *= Math.max(0, (poolLeft - remaining) / poolLeft);
  }

  return Math.max(0, 1 - pMiss);
}

// === SCORING — direct port from analytical.ts ===

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  if (legalActions.length === 1) return legalActions[0];

  var me = state.players[playerIndex];
  var oppIndex = (playerIndex + 1) % 2;
  var opp = state.players[oppIndex];
  var myHand = me.hand || [];
  var oppHandSize = (opp.hand || []).length;
  var deckSize = (state.deck || []).length;

  // Count our ranks
  var myCounts = {};
  for (var i = 0; i < myHand.length; i++) {
    myCounts[myHand[i].rank] = (myCounts[myHand[i].rank] || 0) + 1;
  }

  // Reconstruct beliefs from game log
  var beliefs = reconstructBeliefs(
    state.log || [],
    me.name, opp.name,
    myHand, me.books || [], opp.books || []
  );

  // Score each action — same formula as analytical.ts
  var scored = [];
  for (var i = 0; i < legalActions.length; i++) {
    var action = legalActions[i];
    var rank = action.rank;
    var myCount = myCounts[rank] || 0;

    var rawP = estimateProbability(rank, myCount, beliefs, oppHandSize, deckSize);

    // Calibration deflation — flat 0.85 for uncertain probabilities
    var p;
    if (rawP >= 0.99 || rawP <= 0.01) {
      p = rawP;
    } else {
      p = rawP * 0.85;
    }

    // Book proximity weight (from our proven [1, 2, 5, 20] weights)
    var bookWeight = myCount >= 3 ? 20 : myCount >= 2 ? 5 : 1;

    // Opponent asked bonus
    var oppAskBonus = beliefs.oppAskedRanks[rank] ? 1.4 : 1.0;

    var score = p * bookWeight * oppAskBonus;

    scored.push({
      action: action,
      score: score,
      p: p,
      rawP: rawP,
      myCount: myCount,
      immediateBook: myCount >= 3
    });
  }

  // Sort: certain hits first, then by score, then by count
  scored.sort(function(a, b) {
    if (a.rawP >= 0.99 && b.rawP < 0.99) return -1;
    if (b.rawP >= 0.99 && a.rawP < 0.99) return 1;
    if (a.rawP >= 0.99 && b.rawP >= 0.99) return b.myCount - a.myCount;
    if (b.score !== a.score) return b.score - a.score;
    if (b.myCount !== a.myCount) return b.myCount - a.myCount;
    return a.action.rank.localeCompare(b.action.rank);
  });

  // Validate
  var choice = scored[0].action;
  for (var t = 0; t < legalActions.length; t++) {
    if (legalActions[t].type === choice.type && legalActions[t].rank === choice.rank) return choice;
  }
  return legalActions[0];
}

(function(root) {
  var api = { pickMove: pickMove };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies['clawbuddy-v2'] = api;
})(typeof self !== 'undefined' ? self : this);
