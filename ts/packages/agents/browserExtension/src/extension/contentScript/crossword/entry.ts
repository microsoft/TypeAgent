// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CrosswordDirection } from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import type { CandidateNode, Collected } from "./collector";
import { enterExolve } from "./exolveEntry";
import { simulateMouseClick } from "../../mouseEvents";

type Cell = {
    node: HTMLElement;
    letterNode: Element | null;
    number: string;
    blocked: boolean;
    letter: string;
};

type Grid = {
    clue: HTMLElement;
    activate: () => void;
    rows: () => HTMLElement[][];
    read: (node: HTMLElement) => Cell;
    focused: () => Element | null;
    active: () => boolean;
    input: Element;
};

export function typeCrosswordKey(char: string): void {
    const target = document.activeElement;
    if (!target) throw new Error("wrong_grid_focus");
    for (const type of ["keydown", "keypress", "keyup"]) {
        if (document.activeElement !== target)
            throw new Error("wrong_grid_focus");
        target.dispatchEvent(
            new KeyboardEvent(type, {
                key: char,
                code: `Key${char.toUpperCase()}`,
                charCode: char.charCodeAt(0),
                keyCode: char.charCodeAt(0),
                which: char.charCodeAt(0),
                bubbles: true,
                cancelable: true,
            }),
        );
    }
}

function cell(
    node: HTMLElement,
    letterNode: Element | null,
    number: string,
    blocked: boolean,
): Cell {
    const letter = letterNode?.textContent?.trim().toUpperCase() ?? "";
    if ((!blocked && !letterNode) || !/^[A-Z]?$/.test(letter))
        throw new Error("unsupported: grid cell characters or mapping");
    return { node, letterNode, number, blocked, letter };
}

function pzzlGrid(
    node: Element,
    number: number,
    direction: CrosswordDirection,
): Grid {
    const clue = node.closest<HTMLElement>(".xwordjs-clue");
    const root = clue?.closest(".xwordjs-container");
    const group = clue?.closest(".xwordjs-cluelist");
    if (
        !clue ||
        !root ||
        clue.textContent?.trim().match(/^(\d+)\./)?.[1] !== String(number) ||
        group?.previousElementSibling?.textContent?.trim().toLowerCase() !==
            direction
    )
        throw new Error("unsupported: PZZL clue mapping");
    return {
        clue,
        activate: () => clue.click(),
        input: document.body,
        rows: () =>
            Array.from(
                root.querySelectorAll("#xwordjs-grid .xwordjs-grid-row"),
                (row) =>
                    Array.from(
                        row.querySelectorAll<HTMLElement>(
                            ":scope > .xwordjs-cell",
                        ),
                    ),
            ),
        read: (node) =>
            cell(
                node,
                node.querySelector(".xwordjs-cell-text"),
                node
                    .querySelector(".xwordjs-cell-number")
                    ?.textContent?.trim() ?? "",
                node.classList.contains("xwordjs-cell-black"),
            ),
        focused: () => root.querySelector(".xwordjs-cell-focus"),
        active: () => clue.classList.contains("xwordjs-clue-active"),
    };
}

function universalGrid(
    node: Element,
    number: number,
    direction: CrosswordDirection,
): Grid {
    const clue = node.closest<HTMLElement>(".clue");
    const root = clue?.closest(".main_container");
    const input = document.querySelector<HTMLInputElement>("input#inp");
    const target = clue?.querySelector<HTMLElement>(":scope > div");
    if (
        !clue ||
        !root ||
        clue.id !== `${direction}${number}` ||
        clue.parentElement?.id !== `${direction}_clues` ||
        !input ||
        !target
    )
        throw new Error("unsupported: Universal clue or input mapping");
    return {
        clue,
        activate: () => simulateMouseClick(target),
        input,
        rows: () =>
            Array.from(root.querySelectorAll("#canvas > tbody > tr"), (row) =>
                Array.from(
                    row.querySelectorAll<HTMLElement>(
                        ":scope > td.box,:scope > td.black",
                    ),
                ),
            ),
        read: (node) =>
            cell(
                node,
                node.querySelector(":scope > div"),
                node.querySelector(":scope > span")?.textContent?.trim() ?? "",
                node.classList.contains("black"),
            ),
        focused: () => root.querySelector("#canvas .selected_cell_first"),
        active: () => !!clue.querySelector(":scope > div.selected"),
    };
}

function prepareGrid(
    grid: Grid,
    value: string,
    number: number,
    direction: CrosswordDirection,
) {
    const rows = grid.rows();
    const width = rows[0]?.length ?? 0;
    if (!width || rows.some((row) => row.length !== width))
        throw new Error("unsupported: non-rectangular grid");
    const cells = rows.flat().map(grid.read);
    if (new Set(cells.map((cell) => cell.node)).size !== cells.length)
        throw new Error("unsupported: duplicate grid cells");
    const starts = cells.filter(
        (cell) => !cell.blocked && cell.number === String(number),
    );
    if (starts.length !== 1)
        throw new Error("unsupported: grid number mapping");
    const start = cells.indexOf(starts[0]);
    const step = direction === "across" ? 1 : width;
    const previous = cells[start - step];
    if (
        previous &&
        !previous.blocked &&
        (direction === "down" || start % width !== 0)
    )
        throw new Error("unsupported: grid number is not light start");
    const light: Cell[] = [];
    for (let i = start; i < cells.length; i += step) {
        if (
            cells[i].blocked ||
            (direction === "across" &&
                Math.floor(i / width) !== Math.floor(start / width))
        )
            break;
        light.push(cells[i]);
    }
    const normalized = value.toUpperCase();
    if (light.length !== normalized.length)
        throw new Error("unsupported: answer length mismatch");
    if (light.some((cell, i) => cell.letter && cell.letter !== normalized[i]))
        throw new Error("crossing_conflict: existing letters protected");
    return { cells, light, normalized };
}

function verifyGrid(
    grid: Grid,
    cells: Cell[],
    light: Cell[],
    normalized: string,
    entered: number,
): void {
    const fresh = grid.rows().flat().map(grid.read);
    if (fresh.length !== cells.length) throw new Error("stale_grid_mapping");
    for (const [index, current] of fresh.entries()) {
        const original = cells[index];
        if (
            current.node !== original.node ||
            current.letterNode !== original.letterNode ||
            current.number !== original.number ||
            current.blocked !== original.blocked
        )
            throw new Error("stale_grid_mapping");
        const target = light.indexOf(original);
        const expected =
            target >= 0 && target < entered
                ? normalized[target]
                : original.letter;
        if (current.letter !== expected)
            throw new Error(
                target < 0
                    ? "protected_crossing_changed"
                    : "rendered_readback_failed",
            );
    }
}

function enterKeyboardGrid(
    grid: Grid,
    value: string,
    number: number,
    direction: CrosswordDirection,
    guard: () => void,
) {
    if (!/^[a-zA-Z]+$/.test(value))
        throw new Error(
            "unsupported: verified entry requires original letters only",
        );
    const { cells, light, normalized } = prepareGrid(
        grid,
        value,
        number,
        direction,
    );
    let entered = 0;
    try {
        guard();
        grid.activate();
        if (grid.focused() !== light[0].node) simulateMouseClick(light[0].node);
        for (const [index, target] of light.entries()) {
            guard();
            verifyGrid(grid, cells, light, normalized, entered);
            if (grid.focused() !== target.node) {
                simulateMouseClick(target.node);
                guard();
                verifyGrid(grid, cells, light, normalized, entered);
            }
            if (
                document.activeElement !== grid.input ||
                !grid.input.isConnected ||
                !grid.clue.isConnected ||
                !grid.active() ||
                grid.focused() !== target.node
            )
                throw new Error("wrong_grid_focus");
            entered++;
            typeCrosswordKey(normalized[index]);
            verifyGrid(grid, cells, light, normalized, entered);
        }
        guard();
        return { entered, verified: true as const };
    } catch (error) {
        throw new Error(
            `partial_entry: ${entered}/${normalized.length} attempted; ${error instanceof Error ? error.message : "verification failed"}; no retry`,
        );
    }
}

export function hasVerifiedCrosswordEntry(node: Element): boolean {
    return !!node.closest(
        ".xlv-frame,.xwordjs-clue,#across_clues .clue,#down_clues .clue",
    );
}

export function enterCrossword(
    state: Pick<Collected, "root">,
    binding: Pick<CandidateNode, "node">,
    value: string,
    number: number,
    direction: CrosswordDirection,
    guard: () => void,
): { entered: number; verified: true } {
    if (!state.root.contains(binding.node))
        throw new Error("stale: selected clue detached");
    if (binding.node.closest(".xwordjs-clue"))
        return enterKeyboardGrid(
            pzzlGrid(binding.node, number, direction),
            value,
            number,
            direction,
            guard,
        );
    if (binding.node.closest("#across_clues .clue,#down_clues .clue"))
        return enterKeyboardGrid(
            universalGrid(binding.node, number, direction),
            value,
            number,
            direction,
            guard,
        );
    if (!binding.node.closest(".xlv-frame"))
        throw new Error(
            "unsupported: verified entry requires a supported Exolve, PZZL or Universal grid and original letters only",
        );
    const row = binding.node.closest("tr");
    return enterExolve(
        state,
        { node: row ?? binding.node },
        value,
        number,
        direction,
        guard,
    );
}
