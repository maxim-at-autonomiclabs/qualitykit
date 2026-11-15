async function loadConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load /api/config");
  return res.json();
}

function injectScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`Failed to load ${src}`)),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadClerk() {
  if (window.__qkClerk) return window.__qkClerk;
  const config = await loadConfig();
  const pk = config.clerkPublishableKey;
  if (!pk || pk.includes("REPLACE")) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY not set. Copy pk_live_… from Clerk → API Keys into wrangler.toml [vars].",
    );
  }

  const proxyUrl = (
    config.clerkProxyUrl || `${location.origin}/__clerk`
  ).replace(/\/$/, "");

  // ClerkJS v6: UI is a separate @clerk/ui bundle (needed for openSignIn).
  const uiUrls = [
    `${proxyUrl}/npm/@clerk/ui@1/dist/ui.browser.js`,
    "https://cdn.jsdelivr.net/npm/@clerk/ui@1/dist/ui.browser.js",
  ];
  let uiLoaded = false;
  for (const src of uiUrls) {
    try {
      await injectScript(src);
      uiLoaded = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!uiLoaded || !window.__internal_ClerkUICtor) {
    throw new Error("Failed to load Clerk UI bundle (@clerk/ui).");
  }

  // Core SDK via ESM (headless); UI attached via load({ ui }).
  const mod = await import(
    /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6.43.1/+esm"
  );
  const ClerkCtor = mod.Clerk || mod.default;
  if (typeof ClerkCtor !== "function") {
    throw new Error("Failed to load ClerkJS ESM.");
  }

  const clerk = new ClerkCtor(pk, { proxyUrl });
  await clerk.load({
    proxyUrl,
    ui: { ClerkUI: window.__internal_ClerkUICtor },
  });
  window.__qkClerk = clerk;
  return clerk;
}

async function api(path, opts = {}) {
  const clerk = window.__qkClerk;
  const token = await clerk.session?.getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refresh() {
  const me = await api("/api/me");
  document.getElementById("plan-line").textContent =
    `Signed in as ${me.user.email} · plan: ${me.user.plan}`;
  const sitesEl = document.getElementById("sites");
  sitesEl.innerHTML = (me.sites || [])
    .map(
      (s) =>
        `<div class="mono">${s.id} · ${s.url} · active=${s.active}
<button data-run="${s.id}">Run now</button>
<button data-latest="${s.id}">Latest</button></div>`,
    )
    .join("");

  sitesEl.querySelectorAll("[data-run]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/sites/${btn.dataset.run}/run`, { method: "POST" });
      alert("Crawl queued");
    };
  });
  sitesEl.querySelectorAll("[data-latest]").forEach((btn) => {
    btn.onclick = async () => {
      const latest = await api(`/api/sites/${btn.dataset.latest}/latest`);
      document.getElementById("latest").textContent = JSON.stringify(
        latest,
        null,
        2,
      );
    };
  });
}

async function main() {
  const status = document.getElementById("status");
  try {
    const clerk = await loadClerk();
    status.textContent = clerk.user
      ? "Signed in"
      : "Sign in to manage Pro monitoring";
    document.getElementById("panel").hidden = !clerk.user;
    document.getElementById("sign-in").hidden = !!clerk.user;
    document.getElementById("sign-out").hidden = !clerk.user;

    document.getElementById("sign-in").onclick = () =>
      clerk.openSignIn({ forceRedirectUrl: "/app.html" });
    document.getElementById("sign-out").onclick = async () => {
      await clerk.signOut();
      location.reload();
    };

    if (!clerk.user) return;

    document.getElementById("panel").hidden = false;
    await refresh();

    document.getElementById("upgrade").onclick = async () => {
      const { url } = await api("/api/billing/checkout", { method: "POST" });
      location.href = url;
    };
    document.getElementById("portal").onclick = async () => {
      const { url } = await api("/api/billing/portal", { method: "POST" });
      location.href = url;
    };
    document.getElementById("mint-key").onclick = async () => {
      const data = await api("/api/keys", { method: "POST" });
      const out = document.getElementById("key-out");
      out.hidden = false;
      out.textContent = data.apiKey;
    };
    document.getElementById("site-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("/api/sites", {
        method: "POST",
        body: JSON.stringify({ url: fd.get("url") }),
      });
      await refresh();
    };
  } catch (err) {
    status.textContent = `Setup needed: ${err.message}`;
  }
}

main();
