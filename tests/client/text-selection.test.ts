import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  captureTextSelection,
  restoreTextSelection,
} from "../../src/client/features/reader/text-selection.js";

describe("article text selection", () => {
  it("restores the selected passage after rendering its action menu", () => {
    const dom = new JSDOM(
      '<div id="article"><p>Read the <a href="#notes">release notes</a> before upgrading.</p></div>',
    );
    const document = dom.window.document;
    const root = document.querySelector<HTMLElement>("#article");
    const paragraph = root?.querySelector("p");
    const startNode = paragraph?.firstChild;
    const endNode = paragraph?.lastChild;
    if (!root || !startNode || !endNode) throw new Error("Article fixture is incomplete");

    const range = document.createRange();
    range.setStart(startNode, 5);
    range.setEnd(endNode, 7);
    const selection = document.getSelection();
    selection?.addRange(range);

    const snapshot = captureTextSelection(root, selection);
    expect(snapshot?.text).toBe("the release notes before");

    root.innerHTML = '<p>Read the <a href="#notes">release notes</a> before upgrading.</p>';
    selection?.removeAllRanges();
    expect(document.getSelection()?.toString()).toBe("");

    expect(snapshot && restoreTextSelection(root, snapshot)).toBe(true);
    expect(document.getSelection()?.toString()).toBe("the release notes before");
  });
});
