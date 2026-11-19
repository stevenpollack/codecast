# Messaging-only codecast

Status: proposal. Nothing here is implemented.

## The problem

Codecast's most useful idea is that agents can message each other across machines and teammates. To get it, though, you have to buy the whole harness: the daemon reads every transcript, installs a set of hooks into Claude Code, writes 26 skills and several CLAUDE.md sections, and will start or resume Claude processes on its own when it can't reach one.

Some people launch their agents from another manager, such as herdr or paseo, and want codecast to do one thing: make those sessions addressable by other agents. They don't want transcript sync, status inference or UI. They're happy to have the agent publish a title or status itself so other agents can find it.

## What stands in the way today

Findings from reading the current code:

- **A session is addressable only once its transcript has been ingested.** `cast send` resolves the target through a `conversations` row (`conversationSessionLookup.ts`), and only transcript ingestion creates that row (`daemon.ts`, `syncService.createConversation`). A project excluded from sync (`excluded_paths`, `sync_mode: selected`, `sync_excluded`) gets no row, so it can't be messaged. No flag, env var or command registers a session without syncing it.
- **Delivery works by pasting into a terminal.** `deliverMessageIntoSession` finds the process's tmux or herdr pane through the SessionStart register hook's pid/tty/term record, then pastes. A paseo agent runs Claude in stream-json mode with no TTY. Its registry entry records tty `?`. On Linux delivery falls through to AppleScript, which fails, and the message retries forever.
- **Confirming delivery relies on the transcript.** A row becomes `delivered` when the pasted text echoes back through transcript sync, or when a status hook reports activity after a paste-verified injection. With neither, the healer re-pends an `injected` row after 120s and the recipient gets duplicates.
- **Unsynced sessions look cold.** `performSessionSend` refuses targets idle past the prompt cache unless `--wake` is passed. It judges that from `usage_totals.updated_at`, falling back to `conversations.updated_at`. A row with no transcript reads as cold permanently.
- **When delivery fails, the daemon starts Claude itself.** It can `materializeSession`, start a fresh Claude (in `$HOME` when the row has no `project_path`), or `autoResumeSession` a second `claude --resume` next to the live process. No per-conversation switch turns this off.
- **A bare row is private.** `createConversation` with only a `session_id` resolves to `is_private: true`, so `canSendProductMessage` refuses teammates.
- **The harness footprint is all-or-nothing and machine-wide.** The status, register, prompt and statusline hooks share one `hooks_enabled` switch, and the bundled skills share one `skills_enabled` switch.
- **No extension point fits.** Mods can observe events such as `session.state` but can't change ingestion or delivery. Capabilities install files into `~/.claude`. Delivery backends are branches inside `deliverMessageIntoSession` rather than adapters.

## Goals

- A machine runs agents launched by anything (herdr, paseo), and each session becomes addressable by teammates' agents through `cast send`.
- Codecast stores no transcript from that machine, and nothing on it ever starts, resumes or materializes a Claude process.
- Agents publish their own purpose and state with the existing `cast rename` and `cast state`. Other agents find them with `cast feed`.
- Everything installed on the Claude side can be removed in one step.

## Non-goals (v1)

- tmux delivery. The daemon's tmux paste has hard-won fixes for double paste, split paste, ghost suggestions, the Enter gate and deaf panes. Reusing them means pulling them out of `daemon.ts` first.
- Any transcript-derived feature: search over message text, idle summaries, activity, insights.
- Per-session opt-in. Messaging-only is a property of the machine.

## Design

```
Claude Code plugin                     Convex                            cast relay (this machine)
──────────────────                     ──────                            ─────────────────────────
SessionStart hook ── cast register ──▶ registerSession                   subscribe: pendingForDevice(device)
  {session_id, cwd, target}              row: register_only, team-shared  claim → deliver → ack
  + start relay if not running         pending_messages (unchanged)        herdr → herdr agent prompt
SessionEnd hook ──── cast unregister ▶ markEnded                            paseo → paseo send
skill: cast send/feed/rename/state                                         failure → mark failed, bounce to sender
agent ───────────────── cast send ──▶ performSessionSend
```

### Claude Code plugin

The Claude-side pieces ship as a Claude Code plugin, hosted as a marketplace in this repo. The codecast installer never edits `~/.claude` on a messaging-only machine, and the user installs, disables or removes the plugin with `/plugin`.

- **SessionStart hook.**
  - Runs `cast register` with the session id, the cwd and the delivery target detected from the environment:
    - herdr: `{kind: "herdr", socket, pane}`. The pane is found by tty with `findHerdrPaneForTty`.
    - paseo: `{kind: "paseo", agentId}`, from `PASEO_AGENT_ID`.
  - Starts `cast relay` if it isn't running. A lock file prevents a second copy.
  - A session with no recognised target isn't registered.
- **SessionEnd hook.** Runs `cast unregister`, which marks the row ended.
- **One skill.** Teaches `cast send`, `cast feed`, `cast rename` and `cast state`, and says that incoming messages arrive wrapped in `<<<<<<` / `>>>>>>`.

### Registration

`cast register` posts directly to Convex over HTTP, as `cast send` does, using the existing `cast login` credentials. The row stores everything needed to deliver:

- `register_only: true`
- `delivery_target`
- the device id
- `cwd`

Because the target lives on the row, the relay keeps no local mapping and no IPC port, and a session registered while the relay was down is still reachable once it comes up.

The row is team-visible, so teammates can find and message it. Its default title is the cwd's folder name, until the agent sets one with `cast rename` or `cast state`.

### `cast relay`

`cast relay` is a subcommand of the existing `cast` binary. It reuses its auth, its Convex client and `herdr.ts`, and the full daemon isn't started. It:

1. Subscribes to `pendingForDevice(device)`: pending messages whose target is a `register_only`, not-ended row on this device.
2. Claims a row, wraps the text as `<<<<<<\n{text}\n>>>>>>`, and delivers by target kind (below).
3. Marks the row delivered when the hand-off succeeds. There's no transcript echo to wait for.
4. On a failure meaning the session is gone, marks the conversation ended and bounces the message to the sender as undeliverable.
5. Sends a heartbeat, so a sender sees "queued, recipient's relay is offline" rather than a false "delivered" while it's down.

The wrapper exists because a message can be appended to text a person has half-typed into the prompt. The markers make the boundary visible to both the person and the agent.

#### herdr

`herdr agent prompt <pane> <text>`: herdr applies the pane's bracketed-paste mode and writes text plus Enter as one ordered submission. It accepts a pane id for any agent herdr detected, not only ones it started.

- **No idle check.** herdr's `idle`/`done` reading depends on per-client focus and "seen" state, and a focused pane with nobody at the keyboard can read as not idle. A message held until idle may never be delivered. If Claude is mid-turn, Claude Code queues the input.
- `ok`: delivered.
- `agent_blocked`: an approval or question dialog is up. Leave the row pending and retry later.
- No agent in the pane: the session is ended. Bounce the message.
- Accepted risk: text half-typed into that exact prompt gets the message appended to it. herdr's own `agent prompt` makes the same trade, and the alternative, scraping the prompt line, is the same kind of unreliable heuristic as idle detection.

#### paseo

`paseo send <agentId> --behavior steer --no-wait --prompt-file <tmp>`

- `steer` adds the message to a running turn instead of interrupting it. `interrupt` is never used.
- `--no-wait`: otherwise `paseo send` blocks until the agent's turn completes.
- `--prompt-file` avoids argv size limits and quoting problems.
- A message to an idle or stopped paseo agent may wake it. Paseo owns that agent's lifecycle; codecast itself still never starts anything.
- An unknown agent id means the session is ended. Bounce the message.

### Convex changes

**New:**
- `registerSession`: creates or updates the row by `session_id`, shared with the team through the visibility chokepoint (`patchConversationVisibility`), never a raw patch.
- `markEnded`: stamps `ended_at`. Sends to an ended row are refused immediately, and the row drops out of `cast feed`.
- `pendingForDevice`: the relay's subscription.
- Conversation fields `register_only`, `delivery_target` and `ended_at`.

**Changed, for `register_only` rows:**
- The daemon's `getPendingMessagesForDaemon` excludes them, so a full daemon and a relay on one machine never both deliver the same message.
- `performSessionSend` skips the cold-send refusal.
- The healer doesn't re-pend them.

These ship through `packages/convex/deploy.sh` before the client code that calls them is pushed.

### Discovery

- `cast feed` already lists rows with zero messages; a registered session shows its title, state, owner and cwd.
- `cast search` matches it by title only.

## Decisions and alternatives

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Where the logic runs | standalone `cast relay` | A mode inside the daemon adds `register_only` branches to a 33k-line file, and has to turn machinery off rather than leave it out. The relay is fail-closed: there is no watcher to leak a transcript. |
| Scope | machine-wide | Per-session opt-in needs per-session hook behaviour, and the hooks are machine-wide today. |
| Registration trigger | automatic on SessionStart | An explicit command relies on the agent remembering to run it. |
| Registration path | straight to Convex | Through the local relay keeps pane ids local, but the relay then has to be up before any session starts. |
| Harness install | Claude Code plugin | The codecast installer edits `~/.claude` directly, which is the invasiveness this removes. |
| Relay lifecycle | started on demand by the hook | A systemd/launchd service is one more thing installed; running it by hand is easy to forget. |
| Delivery targets | herdr and paseo | tmux needs the paste hardening extracted from `daemon.ts` first. |
| herdr gating | none; retry only on `agent_blocked` | Waiting for idle can wait forever on a focused pane. |
| Visibility | team | Registering is for being found. |
| Session end | SessionEnd marks ended, sends bounce | Leaving rows until a delivery fails fills the feed with dead sessions. |

## Rollout

1. Convex: the fields, mutations, query and the three `register_only` checks. Deploy.
2. `cast register`, `cast unregister` and `cast relay`, with the herdr and paseo adapters.
3. The Claude Code plugin and its marketplace entry.
4. End-to-end check on one machine: a herdr session and a paseo session message each other, and a send to an exited session bounces.

## Later

- tmux delivery, after the paste hardening is extracted from `daemon.ts` into a module the relay can share.
- Per-session opt-in on machines that otherwise run full codecast.
