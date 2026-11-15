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
    config.clerkProxyUrl || "https://qualitykit.dev/__clerk"
  ).replace(/\/$/, "");

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

/** Dedupe concurrent getToken calls; never skipCache (that 429s Clerk). */
let tokenInflight = null;
async function getSessionToken() {
  const session = window.__qkClerk?.session;
  if (!session) return null;
  if (tokenInflight) return tokenInflight;
  tokenInflight = session
    .getToken()
    .catch((err) => {
      const msg = String(err?.message || err);
      if (msg.includes("429") || msg.includes("Too Many")) {
        throw new Error(
          "Clerk rate-limited token refresh. Wait ~30s, then refresh the page.",
        );
      }
      throw err;
    })
    .finally(() => {
      tokenInflight = null;
    });
  return tokenInflight;
}

async function api(path, opts = {}) {
  const token = await getSessionToken();
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function setProUi(isPro, hasBillingCustomer) {
  const proTools = document.getElementById("pro-tools");
  const freeNote = document.getElementById("free-note");
  const upgrade = document.getElementById("upgrade");
  const portal = document.getElementById("portal");

  proTools.hidden = !isPro;
  freeNote.hidden = isPro;
  upgrade.hidden = isPro;
  portal.hidden = !isPro && !hasBillingCustomer;
}

async function refresh() {
  const me = await api("/api/me");
  const isPro = me.user.plan === "pro";
  document.getElementById("plan-line").textContent =
    `Signed in as ${me.user.email} · plan: ${me.user.plan}`;

  setProUi(isPro, Boolean(me.user.hasBillingCustomer));

  if (!isPro) {
    document.getElementById("sites").innerHTML = "";
    document.getElementById("latest").textContent = "";
    return me;
  }

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
  return me;
}

async function main() {
  const status = document.getElementById("status");
  try {
    const clerk = await loadClerk();
    let lastUserId = undefined;
    let bootstrapped = false;

    const renderSignedOut = () => {
      status.textContent = "Sign in to manage Pro monitoring";
      document.getElementById("panel").hidden = true;
      document.getElementById("sign-in").hidden = false;
      document.getElementById("sign-out").hidden = true;
    };

    const renderSignedIn = async () => {
      status.textContent = "Signed in";
      document.getElementById("panel").hidden = false;
      document.getElementById("sign-in").hidden = true;
      document.getElementById("sign-out").hidden = false;
      try {
        await refresh();
      } catch (err) {
        status.textContent = `Signed in, but API auth failed: ${err.message}${
          err.payload?.reason ? ` (${err.payload.reason})` : ""
        }. Wait a moment if rate-limited, then refresh.`;
        console.error(err);
      }
    };

    const onAuthChange = async (user) => {
      const id = user?.id ?? null;
      if (bootstrapped && id === lastUserId) return;
      lastUserId = id;
      bootstrapped = true;
      if (user) await renderSignedIn();
      else renderSignedOut();
    };

    document.getElementById("sign-in").onclick = () =>
      clerk.openSignIn({
        forceRedirectUrl: `${location.origin}/app.html`,
        fallbackRedirectUrl: `${location.origin}/app.html`,
      });
    document.getElementById("sign-out").onclick = async () => {
      await clerk.signOut({ redirectUrl: `${location.origin}/app.html` });
    };

    await onAuthChange(clerk.user);
    clerk.addListener(({ user }) => {
      onAuthChange(user);
    });

    document.getElementById("upgrade").onclick = async () => {
      try {
        status.textContent = "Starting checkout…";
        const { url } = await api("/api/billing/checkout", { method: "POST" });
        location.href = url;
      } catch (err) {
        status.textContent = `Checkout failed: ${err.message}${
          err.payload?.reason ? ` (${err.payload.reason})` : ""
        }`;
        alert(status.textContent);
      }
    };
    document.getElementById("portal").onclick = async () => {
      try {
        const { url } = await api("/api/billing/portal", { method: "POST" });
        location.href = url;
      } catch (err) {
        alert(err.message);
      }
    };
    document.getElementById("mint-key").onclick = async () => {
      try {
        const data = await api("/api/keys", { method: "POST" });
        const out = document.getElementById("key-out");
        out.hidden = false;
        out.textContent = data.apiKey;
      } catch (err) {
        alert(err.message);
      }
    };
    document.getElementById("site-form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const fd = new FormData(e.target);
        await api("/api/sites", {
          method: "POST",
          body: JSON.stringify({ url: fd.get("url") }),
        });
        await refresh();
      } catch (err) {
        if (err.status === 402) {
          if (confirm("Pro required to monitor a site. Open checkout?")) {
            document.getElementById("upgrade").click();
          }
          return;
        }
        alert(
          `${err.message}${err.payload?.reason ? ` (${err.payload.reason})` : ""}`,
        );
      }
    };
  } catch (err) {
    status.textContent = `Setup needed: ${err.message}`;
  }
}

main();
