// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enterCrossword } from "../../src/extension/contentScript/crossword/entry";

const cleanups: (() => void)[] = [];
beforeAll(() => {
    Object.defineProperty(window, "PointerEvent", {
        configurable: true,
        value: MouseEvent,
    });
});
afterEach(() => {
    cleanups.splice(0).forEach((dispose) => dispose());
    document.body.replaceChildren();
});

function engine(kind: "pzzl" | "universal", skipFilled = false) {
    const numbers = ["1", "2", "3", "", "4", "", "5", ""];
    const blocked = new Set([3, 5, 7]);
    const cells = numbers.map((number, i) =>
        kind === "pzzl"
            ? `<div class="xwordjs-cell ${blocked.has(i) ? "xwordjs-cell-black" : ""}">
                <div class="xwordjs-cell-number">${number}</div>
                <div class="xwordjs-cell-text">${i === 6 ? "Z" : ""}</div></div>`
            : `<td id="${Math.floor(i / 4)}_${i % 4}" class="${blocked.has(i) ? "black" : "box"}">
                ${blocked.has(i) ? "" : `<span>${number}</span><div>${i === 6 ? "Z" : ""}</div>`}</td>`,
    );
    const groups = ["across", "down"]
        .map((direction) =>
            kind === "pzzl"
                ? `<h3>${direction}</h3><div class="xwordjs-cluelist"><div class="xwordjs-clue" id="${direction}1">1. Clue text</div></div>`
                : `<div id="${direction}_clues"><div class="clue" id="${direction}1"><div><b>1</b><span>Clue text</span></div></div></div>`,
        )
        .join("");
    document.body.innerHTML =
        kind === "pzzl"
            ? `<div class="xwordjs-container"><div id="xwordjs-grid">${[0, 4].map((i) => `<div class="xwordjs-grid-row">${cells.slice(i, i + 4).join("")}</div>`).join("")}</div>${groups}</div>`
            : `<div class="main_container"><table id="canvas"><tbody>${[0, 4].map((i) => `<tr>${cells.slice(i, i + 4).join("")}</tr>`).join("")}</tbody></table>${groups}</div><input id="inp">`;
    const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(".xwordjs-cell,td"),
    );
    const letters = () =>
        nodes.map((n) =>
            n.querySelector(
                kind === "pzzl" ? ".xwordjs-cell-text" : ":scope > div",
            ),
        );
    const input =
        kind === "pzzl"
            ? document.body
            : document.querySelector<HTMLInputElement>("#inp")!;
    let cursor = 0;
    let step = 1;
    const clicks = jest.fn();
    const focusClass =
        kind === "pzzl" ? "xwordjs-cell-focus" : "selected_cell_first";
    const setCursor = (i: number) => {
        nodes.forEach((n) => n.classList.remove(focusClass));
        nodes[Math.min(i, 7)].classList.add(focusClass);
        cursor = i;
    };
    nodes.forEach((node, i) =>
        node.addEventListener("mouseup", () => setCursor(i)),
    );
    for (const direction of ["across", "down"]) {
        const clue = document.querySelector<HTMLElement>(`#${direction}1`)!;
        const target =
            kind === "pzzl"
                ? clue
                : clue.querySelector<HTMLElement>(":scope > div")!;
        target.addEventListener(kind === "pzzl" ? "click" : "mouseup", () => {
            clicks();
            document
                .querySelectorAll(".xwordjs-clue-active,.selected")
                .forEach((n) =>
                    n.classList.remove("xwordjs-clue-active", "selected"),
                );
            target.classList.add(
                kind === "pzzl" ? "xwordjs-clue-active" : "selected",
            );
            step = direction === "across" ? 1 : 4;
            setCursor(0);
            if (input instanceof HTMLInputElement) input.focus();
        });
    }
    const key = (event: KeyboardEvent) => {
        if (!/^[A-Z]$/.test(event.key)) return;
        letters()[cursor]!.textContent = event.key;
        let next = cursor + step;
        while (
            skipFilled &&
            next < nodes.length &&
            letters()[next]?.textContent
        )
            next += step;
        setCursor(next);
    };
    document.body.addEventListener("keydown", key);
    cleanups.push(() => document.body.removeEventListener("keydown", key));
    const enter = (
        value = "CAT",
        direction: "across" | "down" = "across",
        number = 1,
        guard = () => {},
    ) =>
        enterCrossword(
            { root: document.body },
            {
                node:
                    document.querySelector(`#${direction}1 span`) ??
                    document.querySelector(`#${direction}1`)!,
            },
            value,
            number,
            direction,
            guard,
        );
    return { enter, letters, nodes, clicks, input };
}

describe.each(["pzzl", "universal"] as const)(
    "%s verified physical entry",
    (kind) => {
        test("clicks the actual handler, types uppercase and preserves all other cells", () => {
            const grid = engine(kind);
            expect(grid.enter("cat")).toEqual({ entered: 3, verified: true });
            expect(grid.letters().map((n) => n?.textContent ?? "")).toEqual([
                "C",
                "A",
                "T",
                "",
                "",
                "",
                "Z",
                "",
            ]);
            expect(grid.clicks).toHaveBeenCalledTimes(1);
        });

        test("maps Down independently of Across and preserves matching crossings", () => {
            const grid = engine(kind);
            grid.letters()[0]!.textContent = "C";
            expect(grid.enter("CO", "down")).toEqual({
                entered: 2,
                verified: true,
            });
            expect(grid.letters()[4]!.textContent).toBe("O");
            expect(grid.letters()[6]!.textContent).toBe("Z");
        });

        test("repositions safely when an engine auto-skips a matching crossing", () => {
            const grid = engine(kind, true);
            grid.letters()[1]!.textContent = "A";
            expect(grid.enter()).toEqual({ entered: 3, verified: true });
            expect(
                grid
                    .letters()
                    .slice(0, 3)
                    .map((n) => n?.textContent),
            ).toEqual(["C", "A", "T"]);
        });

        test("rejects physical clue mismatches before clicking", () => {
            const grid = engine(kind);
            expect(() => grid.enter("CAT", "across", 2)).toThrow("clue");
            expect(grid.clicks).not.toHaveBeenCalled();
        });

        test("rejects conflicts, wrong lengths and nonletter input before clicking", () => {
            const grid = engine(kind);
            expect(() => grid.enter("FOUR")).toThrow("answer length");
            expect(() => grid.enter("C-T")).toThrow("original letters");
            grid.letters()[1]!.textContent = "X";
            expect(() => grid.enter()).toThrow("crossing_conflict");
            expect(grid.clicks).not.toHaveBeenCalled();
        });

        test("rejects malformed grid geometry before clicking", () => {
            const grid = engine(kind);
            grid.nodes[7].remove();
            expect(() => grid.enter()).toThrow("non-rectangular");
            expect(grid.clicks).not.toHaveBeenCalled();
        });

        test("stops on focus loss after the first keydown, without replay or later keys", () => {
            const grid = engine(kind);
            const foreign = document.createElement("input");
            document.body.append(foreign);
            document.body.addEventListener("keydown", () => foreign.focus(), {
                once: true,
            });
            expect(() => grid.enter()).toThrow(
                "partial_entry: 1/3 attempted; wrong_grid_focus; no retry",
            );
            expect(
                grid
                    .letters()
                    .slice(0, 3)
                    .map((n) => n?.textContent),
            ).toEqual(["C", "", ""]);
            expect(grid.clicks).toHaveBeenCalledTimes(1);
        });

        test("detects protected-cell mutation immediately after a keystroke", () => {
            const grid = engine(kind);
            document.body.addEventListener(
                "keydown",
                () => {
                    grid.letters()[6]!.textContent = "Q";
                },
                { once: true },
            );
            expect(() => grid.enter()).toThrow("protected_crossing_changed");
            expect(grid.letters()[1]!.textContent).toBe("");
        });

        test("detects grid replacement after a key without typing into the replacement", () => {
            const grid = engine(kind);
            document.body.addEventListener(
                "keydown",
                () => grid.nodes[1].replaceWith(grid.nodes[1].cloneNode(true)),
                { once: true },
            );
            expect(() => grid.enter()).toThrow("stale_grid_mapping");
            expect(grid.letters()[1]!.textContent).toBe("");
        });

        test("honors invalidation after a potentially applied write without retrying", () => {
            const grid = engine(kind);
            let calls = 0;
            expect(() =>
                grid.enter("CAT", "across", 1, () => {
                    if (++calls === 3) throw new Error("stale: puzzle changed");
                }),
            ).toThrow(
                "partial_entry: 1/3 attempted; stale: puzzle changed; no retry",
            );
            expect(grid.letters()[1]!.textContent).toBe("");
            expect(grid.clicks).toHaveBeenCalledTimes(1);
        });
    },
);
