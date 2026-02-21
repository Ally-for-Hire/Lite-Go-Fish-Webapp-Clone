(function (root) {
  async function loadOne(file) {
    if (typeof file !== "string" || !file.endsWith(".js")) return;
    const src = `policies/${file}`;

    // Avoid duplicate loads.
    if (document.querySelector(`script[data-policy-src="${src}"]`)) return;

    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.dataset.policySrc = src;
      s.onload = resolve;
      s.onerror = () => {
        console.warn(`Policy loader: failed to load ${src}`);
        resolve();
      };
      document.body.appendChild(s);
    });
  }

  async function loadPolicyScripts() {
    const files = Array.isArray(root.GoFishPolicyManifest) ? root.GoFishPolicyManifest : [];
    for (const file of files) {
      await loadOne(file);
    }
  }

  root.__loadPolicies = loadPolicyScripts;
})(typeof window !== "undefined" ? window : globalThis);
