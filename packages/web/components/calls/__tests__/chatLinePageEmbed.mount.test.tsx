// An agent in a call answers with a page: its URL alone on a line of the
// reply (HUDDLE_REPLY_NOTE). The room's chat shows that page inline, in the
// stage rail beside the call and on the call's own page alike.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { ConvexProvider } from "convex/react";
import { replaceGlobals } from "../../../test-helpers/globals";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { offlineConvexClient } from "../../../test-helpers/offlineConvex";

const client = offlineConvexClient("https://example.convex.cloud");
const watchQuery = spyOn(client, "watchQuery").mockImplementation((() => ({
  onUpdate: () => () => {},
  localQueryResult: () => undefined,
  localQueryLogs: () => undefined,
  journal: () => undefined,
})) as never);

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/calls" });
(dom.window.Element.prototype as any).moveBefore = function (this: Element, node: Node, child: Node | null) {
  this.insertBefore(node, child);
};
const restoreGlobals = replaceGlobals({
  window: Object.assign(dom.window, { innerWidth: 1400 }),
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { ChatLine } = await import("../RoomThreadRows");
const { useInboxStore } = await import("../../../store/inboxStore");

afterAll(async () => {
  watchQuery.mockRestore();
  await client.close();
  closeDomWindow(dom);
  restoreGlobals();
});

const slug = "Funnel123456";
useInboxStore.setState({ pageEmbeds: { ...(useInboxStore.getState() as any).pageEmbeds, [slug]: { _id: slug, slug, gated: false, title: "Pitch funnel", version: 1 } } } as any);

const row: any = {
  _id: "m1",
  at: Date.now(),
  text: `Samvit, half the pitches never get raised; the funnel is on this page.\n\nhttps://codecast.sh/a/${slug}`,
  agent: { conversation_id: "c1", title: "Basil team huddle", name: "Basil" },
};

describe("a page in an agent's call reply", () => {
  for (const stage of [true, false]) {
    test(stage ? "embeds in the stage rail" : "embeds on the call page", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(() =>
        root.render(
          <ConvexProvider client={client}>
            <ChatLine m={row} sameAuthor={false} fresh={false} dayOf={undefined} stage={stage} onOpen={() => {}} />
          </ConvexProvider>,
        ),
      );
      const frame = container.querySelector("iframe");
      expect(frame).not.toBeNull();
      expect(frame!.getAttribute("src") ?? "").toContain(slug);
      await act(() => root.unmount());
      container.remove();
    });
  }
});
