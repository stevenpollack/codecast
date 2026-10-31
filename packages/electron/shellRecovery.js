// The page a shell window falls back to when the app cannot draw itself.
//
// Without it a window whose load failed for good (offline at wake, server
// down), or whose renderer died, shows only its #002b36 background: no mark,
// no words, and no control, so the only way out was View > Force Reload, which
// nobody knows is there. This page is a data: URL, so it renders with no
// network, and it carries one button that goes back to the app. It also
// retries by itself when the machine comes back online.
const RECOVERY_PREFIX = "data:text/html;charset=utf-8,";

const TITLES = {
  offline: "Codecast couldn’t load",
  stalled: "Codecast stopped loading",
  crashed: "This window crashed",
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function recoveryPageUrl(reason, retryUrl) {
  const title = TITLES[reason] ?? TITLES.offline;
  const target = JSON.stringify(String(retryUrl)).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Codecast</title>
<style>
  html, body { margin: 0; height: 100%; background: #002b36; color: #93a1a1;
    font: 13px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace; -webkit-app-region: drag; }
  main { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
  h1 { margin: 0; font-size: 14px; font-weight: 500; color: #eee8d5; }
  button { -webkit-app-region: no-drag; font: inherit; color: #002b36; background: #2aa198; border: 0;
    border-radius: 6px; padding: 7px 18px; cursor: pointer; }
  button:hover { background: #35b5ab; }
</style></head><body><main>
  <h1>${escapeHtml(title)}</h1>
  <button id="reload" autofocus>Reload</button>
</main><script>
  const go = () => { location.href = ${target}; };
  document.getElementById("reload").onclick = go;
  addEventListener("online", go);
</script></body></html>`;
  return RECOVERY_PREFIX + encodeURIComponent(html);
}

function isRecoveryUrl(url) {
  return typeof url === "string" && url.startsWith(RECOVERY_PREFIX);
}

// A renderer that died (crash, OOM, killed) leaves the window on its bare
// background while every other window keeps running, so nothing says it is
// gone. A window the person can see gets the recovery page, pointed at the
// page it was on. One they cannot (hidden, or see-through, where an opaque card
// would sit over their work) reloads in place instead, at most once per
// QUIET_RELOAD_MS so a page that kills its renderer on load cannot spin.
// A clean exit is a window closing, and a quitting app takes every renderer
// down with it; neither needs recovering. `onGone` hears every death first and
// may take it over by returning true.
const QUIET_RELOAD_MS = 30_000;

function attachCrashRecovery(win, { isQuitting, fallbackUrl, quiet = false, onGone }) {
  let lastAppUrl = null;
  let lastQuietReload = 0;
  const remember = (url) => {
    if (!isRecoveryUrl(url)) lastAppUrl = url;
  };
  win.webContents.on("did-navigate", (_e, url) => remember(url));
  win.webContents.on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (isMainFrame) remember(url);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details?.reason === "clean-exit" || isQuitting()) return;
    if (win.isDestroyed()) return;
    if (onGone?.(details, lastAppUrl)) return;
    const url = lastAppUrl ?? fallbackUrl();
    if (quiet || !win.isVisible()) {
      if (Date.now() - lastQuietReload < QUIET_RELOAD_MS) return;
      lastQuietReload = Date.now();
      win.loadURL(url);
      return;
    }
    win.loadURL(recoveryPageUrl("crashed", url));
  });
}

// The GPU process draws every window. When it dies, Chromium starts another,
// but a window can stay on its bare background while its page keeps running,
// and Cmd-R does not bring it back. So every window reloads, except those
// `keep` names (the voice window: reloading it would drop a live call).
function attachGpuRecovery(app, { isQuitting, windows, keep, onGone }) {
  app.on("child-process-gone", (_e, details) => {
    if (details?.reason === "clean-exit" || isQuitting()) return;
    onGone?.(details);
    if (details?.type !== "GPU") return;
    for (const win of windows()) {
      if (win.isDestroyed() || keep(win)) continue;
      if (isRecoveryUrl(win.webContents.getURL())) continue;
      win.webContents.reload();
    }
  });
}

module.exports = { recoveryPageUrl, isRecoveryUrl, attachCrashRecovery, attachGpuRecovery, QUIET_RELOAD_MS };
