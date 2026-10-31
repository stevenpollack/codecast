// Feeder: every session the viewer owns (convex sessionIndex.page) into the
// `sessionIndex` collection, the directory the ⌘K palette searches on the
// device. Never a subscription: the range spans every running session, and a
// live query over it would re-run on each of their heartbeats. The head (what
// moved since the newest row held) is read at mount and whenever the palette
// opens; older pages are walked once, between keystrokes, until the server
// says the range is read to its end.
import { useConvex } from "convex/react";
import { api } from "@codecast/convex/convex/_generated/api";
import { useInboxStore } from "../store/inboxStore";
import { useServerAuthSettled } from "./useServerAuthSettled";
import { useWatchEffect } from "./useWatchEffect";
import { whenInputQuiet } from "../lib/inputQuiet";

const META_KEY = "sessionIndex";
/** How far before the newest held row a head read starts, for clocks that disagree. */
const SKEW_MS = 60_000;
/** A palette opened sooner than this after the last head read reads nothing. */
const HEAD_FRESH_MS = 60_000;
/** Pause between two older pages of the walk. */
const WALK_GAP_MS = 1_500;
const WALK_RETRY_MS = 60_000;

type IndexRow = { _id: string; updated_at: number };

function heldRange(): { newest: number | null; oldest: number | null } {
  let newest: number | null = null;
  let oldest: number | null = null;
  for (const row of Object.values(useInboxStore.getState().sessionIndex as Record<string, IndexRow>)) {
    if (newest == null || row.updated_at > newest) newest = row.updated_at;
    if (oldest == null || row.updated_at < oldest) oldest = row.updated_at;
  }
  return { newest, oldest };
}

export function useSyncSessionIndex() {
  const convex = useConvex();
  const settled = useServerAuthSettled();

  useWatchEffect(() => {
    if (!settled) return;
    let stopped = false;
    let lastHead = 0;
    let headRunning = false;
    let cancelWait: (() => void) | null = null;

    const read = async (args: { before?: number; after?: number }) => {
      const res = await convex.query(api.sessionIndex.page, args);
      if (!stopped && res.rows.length) useInboxStore.getState().syncTable("sessionIndex", res.rows as any, { isDelta: true } as any);
      return res;
    };

    // What moved since the newest row held, read down until it meets it.
    const head = async () => {
      if (headRunning || Date.now() - lastHead < HEAD_FRESH_MS) return;
      headRunning = true;
      lastHead = Date.now();
      try {
        const { newest } = heldRange();
        const after = newest == null ? undefined : newest - SKEW_MS;
        let before: number | undefined;
        for (;;) {
          const res = await read({ ...(before != null ? { before } : {}), ...(after != null ? { after } : {}) });
          if (stopped || res.next == null || after == null) break;
          before = res.next;
        }
      } catch (e) {
        console.warn("[feeder:sessionIndex] head failed", e);
      } finally {
        headRunning = false;
      }
    };

    // The rest of history, one page at a time, while nobody is typing.
    // It starts below the oldest row held and follows the server's cursor, which
    // moves even when a page held only workers.
    let cursor: number | null = null;
    const walk = async () => {
      if (stopped || useInboxStore.getState().syncMeta[META_KEY]?.backfilledAt) return;
      cursor ??= heldRange().oldest;
      try {
        const res = await read(cursor == null ? {} : { before: cursor });
        if (stopped) return;
        cursor = res.next;
        if (res.next == null) {
          useInboxStore.getState().recordSyncMeta(META_KEY, { backfilledAt: Date.now() });
          return;
        }
        setTimeout(() => { if (!stopped) cancelWait = whenInputQuiet(walk, 10_000); }, WALK_GAP_MS);
      } catch (e) {
        console.warn("[feeder:sessionIndex] page failed", e);
        setTimeout(() => { if (!stopped) walk(); }, WALK_RETRY_MS);
      }
    };

    head().then(walk);
    const unsubscribe = useInboxStore.subscribe((s, prev) => { if (s.palette.open && !prev.palette.open) head(); });
    return () => { stopped = true; cancelWait?.(); unsubscribe(); };
  }, [settled, convex]);
}
