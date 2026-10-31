// The Prompts page's data: one team day of typed sends (convex
// userSends.teamDay) fed into `teamPrompts`, and the page's reader over it.
import { useCallback, useMemo } from "react";
import { api } from "@codecast/convex/convex/_generated/api";
import type { PromptRow } from "@codecast/convex/convex/userSends";
import { useCollectionRows } from "./useCollectionRows";
import { useSyncCollection, type SyncCollectionResult } from "./useSyncCollection";

export type { PromptRow };

const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const selectRows = (data: { rows: PromptRow[] } | null) => data?.rows;
const promptSig = (r: PromptRow) => `${r._id}|${r.session_title}|${r.text.length}`;
const byTime = (a: PromptRow, b: PromptRow) => a.timestamp - b.timestamp;

export function useSyncPromptDay(teamId: string | undefined, date: string): SyncCollectionResult {
  // Each answer is the whole day: a cached row of that day it lacks is gone.
  const dropAbsent = useCallback((r: PromptRow) => String(r.team_id) === teamId && r.date === date, [teamId, date]);
  const opts = useMemo(() => ({ select: selectRows, dropAbsent }), [dropAbsent]);
  return useSyncCollection(
    "teamPrompts",
    api.userSends.teamDay,
    teamId ? { team_id: teamId as any, date, timezone: VIEWER_ZONE } : "skip",
    opts,
  );
}

/** One day's prompts for the team, oldest first. */
export function usePromptDay(teamId: string | undefined, date: string): PromptRow[] {
  const where = useCallback((r: PromptRow) => !!teamId && String(r.team_id) === teamId && r.date === date, [teamId, date]);
  return useCollectionRows<PromptRow>("teamPrompts", { where, sig: promptSig, sort: byTime });
}
