// DadSlayer v2 (fair-play)
// Public-info belief tracker tuned for aggressive book conversion.

var DSV2_ALL_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function dsv2ReconstructBeliefs(log, meName, oppName, myBooks, oppBooks) {
  var rankState = {};
  for (var i = 0; i < DSV2_ALL_RANKS.length; i++) {
    rankState[DSV2_ALL_RANKS[i]] = { state: 'unknown', drawsSinceAbsent: 0 };
  }

  var oppAskedRanks = {};

  var askRe = /^(.+?) asks for (A|10|[2-9JQK])\.$/;
  var giveRe = /^(.+?) gives (\d+) card\(s\)\.$/;
  var fishRe = /^(.+?) says go fish\.$/;
  var drawRe = /^(.+?) draws a card\.$/;
  var bookRe = /^(.+?) books (.+)\.$/;
  var lastAsk = null;

  for (var i = 0; i < (log || []).length; i++) {
    var line = log[i];
    if (typeof line !== 'string') continue;

    var m = line.match(askRe);
    if (m) {
      var asker = m[1];
      var rank = m[2];
      lastAsk = { asker: asker, rank: rank };
      if (asker === oppName) {
        rankState[rank] = { state: 'has', drawsSinceAbsent: 0 };
        oppAskedRanks[rank] = true;
      }
      continue;
    }

    m = line.match(giveRe);
    if (m && lastAsk) {
      var giver = m[1];
      if (lastAsk.asker === meName && giver === oppName) {
        rankState[lastAsk.rank] = { state: 'absent', drawsSinceAbsent: 0 };
      }
      if (lastAsk.asker === oppName && giver === meName) {
        rankState[lastAsk.rank] = { state: 'has', drawsSinceAbsent: 0 };
      }
      continue;
    }

    m = line.match(fishRe);
    if (m && lastAsk) {
      var speaker = m[1];
      if (lastAsk.asker === meName && speaker === oppName) {
        rankState[lastAsk.rank] = { state: 'absent', drawsSinceAbsent: 0 };
      }
      continue;
    }

    m = line.match(drawRe);
    if (m) {
      var drawer = m[1];
      if (drawer === oppName) {
        for (var r in rankState) {
          if (rankState[r].state === 'absent') rankState[r].drawsSinceAbsent++;
        }
      }
      continue;
    }

    m = line.match(bookRe);
    if (m) {
      var ranks = String(m[2]).split(',');
      for (var j = 0; j < ranks.length; j++) {
        var br = ranks[j].trim();
        if (br && rankState[br]) rankState[br] = { state: 'absent', drawsSinceAbsent: 0 };
      }
    }
  }

  var booked = {};
  for (var i = 0; i < (myBooks || []).length; i++) booked[myBooks[i]] = true;
  for (var i = 0; i < (oppBooks || []).length; i++) booked[oppBooks[i]] = true;

  return { rankState: rankState, oppAskedRanks: oppAskedRanks, booked: booked };
}

function dsv2EstimateProbability(rank, myCount, beliefs, oppHandSize, deckSize) {
  if (beliefs.booked[rank]) return 0;

  var rs = beliefs.rankState[rank];
  if (!rs) return 0;

  if (rs.state === 'has') return 1.0;
  if (rs.state === 'absent' && rs.drawsSinceAbsent === 0) return 0.0;

  var remaining = Math.max(0, 4 - myCount);
  if (remaining === 0) return 0;

  var totalUnknown = Math.max(1, deckSize + oppHandSize);
  var effectiveDraws = oppHandSize;
  if (rs.state === 'absent') effectiveDraws = Math.min(oppHandSize, rs.drawsSinceAbsent);
  if (effectiveDraws <= 0) return 0;

  var pMiss = 1;
  for (var k = 0; k < effectiveDraws; k++) {
    var poolLeft = totalUnknown - k;
    if (poolLeft <= 0) break;
    pMiss *= Math.max(0, (poolLeft - remaining) / poolLeft);
  }

  return Math.max(0, 1 - pMiss);
}

function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  if (legalActions.length === 1) return legalActions[0];

  var me = state.players[playerIndex];
  var opp = state.players[(playerIndex + 1) % 2];
  var myHand = me.hand || [];
  var oppHandSize = (opp.hand || []).length;
  var deckSize = (state.deck || []).length;

  var myCounts = {};
  for (var i = 0; i < myHand.length; i++) {
    myCounts[myHand[i].rank] = (myCounts[myHand[i].rank] || 0) + 1;
  }

  var beliefs = dsv2ReconstructBeliefs(state.log || [], me.name, opp.name, me.books || [], opp.books || []);

  var scored = [];
  for (var i = 0; i < legalActions.length; i++) {
    var action = legalActions[i];
    var rank = action.rank;
    var myCount = myCounts[rank] || 0;

    var rawP = dsv2EstimateProbability(rank, myCount, beliefs, oppHandSize, deckSize);
    var p = (rawP >= 0.99 || rawP <= 0.01) ? rawP : (rawP * 0.9);

    // More aggressive than clawbuddy on closing books.
    var bookWeight = myCount >= 3 ? 26 : myCount >= 2 ? 6 : 1;
    var oppAskBonus = beliefs.oppAskedRanks[rank] ? 1.55 : 1.0;
    var endgameBonus = deckSize <= 10 && myCount >= 2 ? 1.2 : 1.0;

    var score = p * bookWeight * oppAskBonus * endgameBonus;

    scored.push({ action: action, score: score, rawP: rawP, myCount: myCount });
  }

  scored.sort(function(a, b) {
    if (a.rawP >= 0.99 && b.rawP < 0.99) return -1;
    if (b.rawP >= 0.99 && a.rawP < 0.99) return 1;
    if (a.rawP >= 0.99 && b.rawP >= 0.99) return b.myCount - a.myCount;
    if (b.score !== a.score) return b.score - a.score;
    if (b.myCount !== a.myCount) return b.myCount - a.myCount;
    return a.action.rank.localeCompare(b.action.rank);
  });

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
  root.GoFishPolicies['dadslayer-v2'] = api;
})(typeof self !== 'undefined' ? self : this);
