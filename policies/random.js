(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.random = api;
})(typeof self !== "undefined" ? self : this, function () {
  function pickMove(state, legalActions, playerIndex) {
    if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
    return legalActions[Math.floor(Math.random() * legalActions.length)];
  }

  return { pickMove };
});
