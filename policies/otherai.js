// Jason's Go Fish AI — "ClawBuddy"
// Fixed: track go-fish denials to avoid hammering the same rank

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  if (legalActions.length === 1) return legalActions[0];

  var me = state.players[playerIndex];
  var oppIndex = (playerIndex + 1) % 2;
  var opp = state.players[oppIndex];
  var myHand = me.hand || [];
  var oppHandSize = (opp.hand || []).length;
  var deckSize = (state.deck || []).length;
  var myBooks = me.books || [];
  var oppBooks = opp.books || [];
  var log = state.log || [];

  // Count our ranks
  var myCounts = {};
  for (var i = 0; i < myHand.length; i++) {
    var r = myHand[i].rank;
    myCounts[r] = (myCounts[r] || 0) + 1;
  }

  // Booked ranks
  var booked = {};
  for (var i = 0; i < myBooks.length; i++) booked[myBooks[i]] = true;
  for (var i = 0; i < oppBooks.length; i++) booked[oppBooks[i]] = true;

  // Parse log for evidence
  var oppAsked = {};       // ranks opponent asked for (they probably have them)
  var denied = {};         // ranks where we got go-fished (opponent doesn't have)
  var oppDrawsSinceDeny = {}; // how many draws opponent made since denying us
  var lastAsk = null;

  var askRe = /^(.+?) asks for (A|10|[2-9JQK])\.$/;
  var fishRe = /^(.+?) says go fish\.$/;
  var giveRe = /^(.+?) gives (\d+) card\(s\)\.$/;
  var drawRe = /^(.+?) draws a card\.$/;

  for (var i = 0; i < log.length; i++) {
    var line = log[i];
    if (typeof line !== 'string') continue;

    var m = line.match(askRe);
    if (m) {
      lastAsk = { asker: m[1], rank: m[2] };
      if (m[1] === opp.name) {
        oppAsked[m[2]] = true;
      }
      continue;
    }

    m = line.match(giveRe);
    if (m && lastAsk) {
      if (lastAsk.asker === me.name && m[1] === opp.name) {
        // We successfully got cards — opponent had this rank
        delete denied[lastAsk.rank];
      }
      continue;
    }

    m = line.match(fishRe);
    if (m && lastAsk) {
      if (lastAsk.asker === me.name && m[1] === opp.name) {
        // Opponent denied us — they don't have this rank (right now)
        denied[lastAsk.rank] = true;
        oppDrawsSinceDeny[lastAsk.rank] = 0;
      }
      continue;
    }

    m = line.match(drawRe);
    if (m && m[1] === opp.name) {
      // Opponent drew a card — they might now have denied ranks
      for (var rank in oppDrawsSinceDeny) {
        oppDrawsSinceDeny[rank] = (oppDrawsSinceDeny[rank] || 0) + 1;
      }
    }
  }

  var best = legalActions[0];
  var bestScore = -Infinity;

  for (var i = 0; i < legalActions.length; i++) {
    var action = legalActions[i];
    var rank = action.rank;
    var myCount = myCounts[rank] || 0;

    // Hypergeometric P(opponent has at least 1)
    var remaining = booked[rank] ? 0 : Math.max(0, 4 - myCount);
    var totalUnknown = Math.max(1, deckSize + oppHandSize);
    var p = 0;
    if (remaining > 0 && oppHandSize > 0) {
      var pMiss = 1;
      for (var k = 0; k < oppHandSize; k++) {
        var poolLeft = totalUnknown - k;
        if (poolLeft <= 0) break;
        pMiss *= Math.max(0, (poolLeft - remaining) / poolLeft);
      }
      p = 1 - pMiss;
    }

    // Calibration deflation
    if (p > 0.01 && p < 0.99) p *= 0.85;

    // Evidence adjustments
    if (oppAsked[rank]) p = Math.min(1, p * 1.5);  // They asked → they likely have it
    
    if (denied[rank]) {
      var draws = oppDrawsSinceDeny[rank] || 0;
      if (draws === 0) {
        p = 0.02;
      } else {
        var recoveryP = 1 - Math.pow(1 - remaining / Math.max(1, totalUnknown), draws);
        p = Math.min(p, recoveryP * 0.85);
      }
    }

    // Score: probability × book weight + evidence bonuses
    var bookWeight = myCount >= 3 ? 20 : myCount >= 2 ? 5 : 1;
    var score = p * bookWeight;
    if (oppAsked[rank]) score *= 1.4;

    if (score > bestScore || (score === bestScore && myCount > (myCounts[(best || {}).rank] || 0))) {
      bestScore = score;
      best = action;
    }
  }

  return best;
}

(function(root) {
  var api = { pickMove: pickMove };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.otherai = api;
})(typeof self !== "undefined" ? self : this);
