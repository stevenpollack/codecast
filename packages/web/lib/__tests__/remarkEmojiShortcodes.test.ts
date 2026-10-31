import { describe, expect, it } from "bun:test";
import { remarkEmojiShortcodes } from "../remarkEmojiShortcodes";

function render(text: string) {
  const tree: any = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
  };
  remarkEmojiShortcodes()(tree);
  return tree.children[0].children[0].value as string;
}

describe("remarkEmojiShortcodes", () => {
  it("turns a Slack shortcode into the glyph", () => {
    expect(render(":rotating_light: Serper credits exhausted")).toBe("🚨 Serper credits exhausted");
  });

  it("leaves unknown names and a time of day alone", () => {
    expect(render("see :not_a_real_emoji: at 10:30:45")).toBe("see :not_a_real_emoji: at 10:30:45");
  });

  it("does not rewrite a shortcode inside inline code", () => {
    const tree: any = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", value: "run " },
          { type: "inlineCode", value: ":rotating_light:" },
        ],
      }],
    };
    remarkEmojiShortcodes()(tree);
    expect(tree.children[0].children[1].value).toBe(":rotating_light:");
  });

  it("leaves a link's text alone, so a URL embed payload keeps its :link: tag", () => {
    const payload = "embed:link:https%3A%2F%2Fx.com%2Fjsnnsa%2Fstatus%2F2115623382721126826";
    const tree: any = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "link", url: "embed://link:x", children: [{ type: "text", value: payload }] }],
      }],
    };
    remarkEmojiShortcodes()(tree);
    expect(tree.children[0].children[0].children[0].value).toBe(payload);
  });
});
