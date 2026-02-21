function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  return legalActions[Math.floor(Math.random() * legalActions.length)];
}

module.exports = { pickMove };
