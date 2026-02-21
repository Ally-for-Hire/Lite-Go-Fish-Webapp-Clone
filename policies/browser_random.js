(function (root) {
  const policy = {
    pickMove(ctx) {
      const legal = ctx.legalActions || [];
      if (!legal.length) return null;
      return legal[Math.floor(Math.random() * legal.length)];
    },
  };

  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies.random = policy;
})(typeof window !== "undefined" ? window : globalThis);
