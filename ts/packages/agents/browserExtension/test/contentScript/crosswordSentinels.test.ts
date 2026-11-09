// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrosswordSentinels } from "../../src/extension/contentScript/crossword/sentinels";

describe("shared Generative/Decision clue sentinels", () => {
    let changed: jest.Mock;
    let sentinels: CrosswordSentinels;
    let node: Element;

    beforeEach(() => {
        document.body.innerHTML =
            "<main><section><ol><li>1 Original clue</li></ol></section></main><aside>News</aside>";
        node = document.querySelector("li")!;
        changed = jest.fn();
        sentinels = new CrosswordSentinels(changed);
        sentinels.watch(node);
    });

    afterEach(() => sentinels.dispose());

    test("text changes notify once and retire all sentinels", async () => {
        node.firstChild!.textContent = "1 Replacement clue";
        await Promise.resolve();
        expect(changed).toHaveBeenCalledTimes(1);
        node.textContent = "1 Another replacement";
        sentinels.check();
        expect(changed).toHaveBeenCalledTimes(1);
    });

    test("ancestor removal and identical-text replacement change puzzle identity", () => {
        const ancestor = document.querySelector("main")!;
        ancestor.replaceWith(ancestor.cloneNode(true));
        sentinels.check();
        expect(changed).toHaveBeenCalledTimes(1);
    });

    test("publisher text, grid progress, styles and internal markup changes preserve the sentinel", () => {
        document.querySelector("aside")!.textContent = "Latest update";
        document.body.insertAdjacentHTML(
            "beforeend",
            '<input value="A"><div role="status">2 squares filled</div>',
        );
        node.className = "active";
        node.innerHTML = "<span>1</span>  <strong>Original clue</strong>";
        sentinels.check();
        expect(changed).not.toHaveBeenCalled();
    });

    test("only the first five distinct selected nodes are monitored", () => {
        const nodes = Array.from({ length: 6 }, (_, index) => {
            const item = document.createElement("li");
            item.textContent = `Clue ${index}`;
            document.querySelector("ol")!.append(item);
            return item;
        });
        sentinels.clear();
        for (const item of nodes) {
            sentinels.watch(item);
            sentinels.watch(item);
        }
        nodes[5].textContent = "Not a sentinel";
        sentinels.check();
        expect(changed).not.toHaveBeenCalled();
        nodes[4].textContent = "Changed sentinel";
        sentinels.check();
        expect(changed).toHaveBeenCalledTimes(1);
    });

    test("clear and dispose prevent retired observers from invalidating new state", async () => {
        sentinels.clear();
        node.remove();
        await Promise.resolve();
        expect(changed).not.toHaveBeenCalled();
        const replacement = document.querySelector("aside")!;
        sentinels.watch(replacement);
        sentinels.dispose();
        replacement.remove();
        await Promise.resolve();
        expect(changed).not.toHaveBeenCalled();
    });
});
