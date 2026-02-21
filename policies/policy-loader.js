(function (root) {
  async function loadPolicyScripts() {
    try {
      const res = await fetch("policies/manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`manifest load failed: ${res.status}`);
      const files = await res.json();
      if (!Array.isArray(files)) throw new Error("manifest must be an array of filenames");

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
