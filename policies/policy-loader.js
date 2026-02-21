(function (root) {
  async function loadPolicyScripts() {
    try {
      const files = Array.isArray(root.GoFishPolicyManifest) ? root.GoFishPolicyManifest : [];
      if (!files.length) throw new Error("GoFishPolicyManifest is empty or missing");

      for (const file of files) {
        if (typeof file !== "string" || !file.endsWith(".js")) continue;
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = `policies/${file}`;
          s.async = false;
          s.onload = resolve;
          s.onerror = () => reject(new Error(`failed to load ${file}`));
          document.body.appendChild(s);
        });
      }
    } catch (err) {
      console.error("Policy loader error:", err);
    }
  }

  root.__loadPolicies = loadPolicyScripts;
})(typeof window !== "undefined" ? window : globalThis);
