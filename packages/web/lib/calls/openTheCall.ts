import { canPopOutCall } from "../desktop";
import { expandCall } from "./huddleWindow";
import { popOutCall } from "./popOutCall";
import { openCallStage, requestCallThread } from "./callStage";

/**
 * EXPAND: the full stage (video, screen share, transcript), opened only when
 * asked. One of the call's two moves (the other is pop out / dock, between
 * the header and the float): expand goes to the stage from wherever the row
 * is, and the stage's shrink goes back. In a browser the stage is an overlay
 * in this page; on the desktop it is the call window (lib/calls/huddleWindow).
 */
export function openTheCall(thread = false): void {
  if (thread) requestCallThread();
  if (!canPopOutCall()) return openCallStage();
  void expandCall({ thread }).then((shown) => {
    if (!shown) void popOutCall();
  });
}
