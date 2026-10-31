// Run: node --test packages/electron/shellRecovery.main.test.js
//
// A main window that cannot draw the app shows the recovery page and its
// Reload button, never the bare window background.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { harness, openCallWindow } = require("./mainTestRig");
const { recoveryPageUrl, isRecoveryUrl } = require("./shellRecovery");

beforeEach(harness.setup);
afterEach(harness.teardown);

function pageOf(url) {
  assert.ok(isRecoveryUrl(url), `expected the recovery page, got ${url.slice(0, 80)}`);
  return decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));
}

const failLoad = (win, url) => win.webContents.emit("did-fail-load", {}, -106, "ERR_INTERNET_DISCONNECTED", url, true);

test("when every load retry fails, the window shows the recovery page pointed back at the app", async () => {
  const rig = harness.loadShell();
  const win = rig.mainWindow;
  const appUrl = win.last("loadURL")[0];
  for (let i = 0; i < 10; i++) {
    failLoad(win, appUrl);
    await new Promise((r) => setTimeout(r, 520));
    if (isRecoveryUrl(win.last("loadURL")[0])) break;
  }
  const html = pageOf(win.last("loadURL")[0]);
  assert.match(html, /Codecast couldn’t load/);
  assert.match(html, /<button id="reload"/);
  assert.ok(html.includes(JSON.stringify(appUrl)), "Reload goes back to the page that failed");

  // The recovery page finishing its own load is not the app arriving.
  win.webContents.emit("did-finish-load");
  assert.ok(isRecoveryUrl(win.last("loadURL")[0]));

  // Reload starts a fresh budget: one failure retries the app, not the page.
  failLoad(win, appUrl);
  await new Promise((r) => setTimeout(r, 520));
  assert.equal(win.last("loadURL")[0], appUrl);
});

test("a crashed renderer shows the recovery page for the page it was on; a clean exit does not", () => {
  const rig = harness.loadShell();
  const win = rig.mainWindow;
  win.show();
  win.webContents.emit("did-navigate", {}, "https://codecast.sh/conversation/abc");
  win.webContents.emit("render-process-gone", {}, { reason: "clean-exit" });
  assert.ok(!isRecoveryUrl(win.last("loadURL")[0]));

  win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  const html = pageOf(win.last("loadURL")[0]);
  assert.match(html, /This window crashed/);
  assert.ok(html.includes('"https://codecast.sh/conversation/abc"'));
});

test("the page escapes the URL it embeds", () => {
  const html = pageOf(recoveryPageUrl("offline", 'https://x.test/"</script><b>'));
  assert.ok(!html.includes("</script><b>"));
});

// Every window, not just the main one: Alex's blank window (2026-10-26) was a
// popped-out conversation whose renderer died while the rest of the app ran on.
function openBreakout(rig, navPath = "/conversation/abc") {
  rig.handlers.get("detach-tab")(rig.event(), navPath);
  const win = rig.windows[rig.windows.length - 1];
  win.show();
  return win;
}

function recordSends(win) {
  const sent = [];
  win.webContents.send = (channel, payload) => sent.push([channel, payload]);
  return sent;
}

test("a breakout window whose renderer dies shows the recovery page for the route it was on", () => {
  const rig = harness.loadShell();
  const win = openBreakout(rig);
  win.webContents.emit("did-navigate-in-page", {}, "https://codecast.sh/conversation/xyz", true);
  win.webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 5 });
  const html = pageOf(win.last("loadURL")[0]);
  assert.match(html, /This window crashed/);
  assert.ok(html.includes('"https://codecast.sh/conversation/xyz"'));
});

test("a hidden window reloads in place instead, at most once per cooldown", () => {
  const rig = harness.loadShell();
  const win = openBreakout(rig);
  win.hide();
  win.webContents.emit("did-navigate", {}, "https://codecast.sh/conversation/abc");
  const before = win.did("loadURL").length;
  win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(win.last("loadURL")[0], "https://codecast.sh/conversation/abc");
  win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(win.did("loadURL").length, before + 1, "a second death inside the cooldown does not reload again");
});

test("every death reaches the main window's page, held while that page is not up", () => {
  const rig = harness.loadShell();
  rig.mainWindow.show();
  const sent = recordSends(rig.mainWindow);
  const win = openBreakout(rig);
  win.webContents.emit("did-navigate", {}, "https://codecast.sh/conversation/abc");
  win.webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 5 });
  assert.deepEqual(sent, [["shell-process-gone",
    { process: "renderer", reason: "oom", exit_code: 5, window: "conversation", visible: true }]]);

  // The main window's own death is reported once its page is back.
  sent.length = 0;
  rig.mainWindow.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  assert.equal(sent.length, 0, "nothing is sent into the recovery page");
  rig.mainWindow.loadURL("https://codecast.sh/inbox");
  rig.mainWindow.webContents.emit("did-finish-load");
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].window, "main");
});

test("the GPU process dying reloads every window but the voice window, and is reported", () => {
  const rig = harness.loadShell();
  const sent = recordSends(rig.mainWindow);
  const tab = openBreakout(rig);
  const { win: voice } = openCallWindow(rig);
  voice.loadURL("https://codecast.sh/call-panel?room=x");
  rig.listeners.get("child-process-gone")({}, { type: "GPU", reason: "crashed", exitCode: 9 });
  assert.equal(rig.mainWindow.did("reload").length, 1);
  assert.equal(tab.did("reload").length, 1);
  assert.equal(voice.did("reload").length, 0);
  assert.deepEqual(sent.at(-1), ["shell-process-gone",
    { process: "GPU", reason: "crashed", exit_code: 9, window: "app", visible: true }]);

  // A helper that is not the GPU process is only reported.
  rig.listeners.get("child-process-gone")({}, { type: "Utility", reason: "crashed", exitCode: 1 });
  assert.equal(tab.did("reload").length, 1);
  assert.equal(sent.at(-1)[1].process, "Utility");
});
