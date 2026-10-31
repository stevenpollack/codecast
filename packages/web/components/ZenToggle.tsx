"use client";

// Zen mode's one control. Outside zen it sits in the top bar; zen hides the
// top bar, so the same control moves to the window's top-left corner (right of
// the traffic lights on the desktop) and stays there on every page. The arrows
// say what pressing does to the chrome: inward folds it away, outward brings it
// back. Page top rows clear the corner (hooks/useTitlebarHead).

import { Maximize2, Minimize2 } from "lucide-react";
import { useInboxStore } from "../store/inboxStore";
import { useShortcuts } from "../shortcuts";
import { useTipActions } from "../tips";
import { zenToggleLeft } from "../lib/desktop";
import { ShortcutTooltip } from "./KeyboardShortcutsHelp";
import { TopbarButton } from "./TopbarButton";

export function ZenToggle() {
  const zen = useInboxStore((s) => s.clientState.ui?.zen_mode ?? false);
  const { dispatchAction } = useShortcuts();
  const tipActions = useTipActions();
  const label = zen ? "Exit zen mode" : "Enter zen mode";
  return (
    <ShortcutTooltip label={label} action="ui.zenToggle" side="bottom">
      <TopbarButton
        onClick={(e) => { dispatchAction("ui.zenToggle"); tipActions.whisper("ui.zenToggle", e); }}
        aria-label={label}
        desktopOnly
      >
        {zen ? <Maximize2 /> : <Minimize2 />}
      </TopbarButton>
    </ShortcutTooltip>
  );
}

/** Zen's corner: the toggle, pinned level with the traffic lights. */
export function ZenCorner() {
  return (
    <div data-zen-corner data-flyout className="fixed top-1 z-[110] hidden md:block" style={{ left: zenToggleLeft() }}>
      <ZenToggle />
    </div>
  );
}
