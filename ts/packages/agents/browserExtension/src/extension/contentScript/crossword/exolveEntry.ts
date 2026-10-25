// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CrosswordDirection } from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { textOf, type CandidateNode, type Collected } from "./collector";

type Cell = {
    node: Element;
    rect: Element;
    x: number;
    y: number;
    width: number;
    height: number;
    letter: string;
};

function cellsOf(root: Element): Cell[] {
    const letters = Array.from(root.querySelectorAll("svg text.xlv-cell-text"));
    if (!letters.length)
        throw new Error("unsupported: Exolve SVG grid unavailable");
    return letters.map((node) => {
        const rects = node.parentElement?.querySelectorAll(":scope > rect");
        if (rects?.length !== 1)
            throw new Error("unsupported: non-rectangular Exolve grid");
        const rect = rects[0];
        const numeric = (name: string) => Number(rect.getAttribute(name));
        const result = {
            node,
            rect,
            x: numeric("x"),
            y: numeric("y"),
            width: numeric("width"),
            height: numeric("height"),
            letter: node.textContent?.trim() ?? "",
        };
        if (
            ![result.x, result.y, result.width, result.height].every(
                Number.isFinite,
            ) ||
            result.width <= 0 ||
            result.height <= 0 ||
            !/^[A-Z]?$/.test(result.letter)
        )
            throw new Error("unsupported: Exolve cell geometry or characters");
        return result;
    });
}

function prepareEntry(
    state: Collected,
    binding: CandidateNode,
    value: string,
    number: number,
    direction: CrosswordDirection,
) {
    const root = binding.node.closest(".xlv-frame");
    if (!root || !state.root.contains(root) || !/^[a-zA-Z]+$/.test(value))
        throw new Error(
            "unsupported: verified entry requires rectangular Exolve and original letters only",
        );
    const label = binding.node.querySelector(".xlv-clue-label");
    if (!label || textOf(label).replace(/[.\s]/g, "") !== String(number))
        throw new Error("unsupported: clue label mapping");
    const group = binding.node.closest("[id$='-across'],[id$='-down']");
    if (!group?.id.endsWith(`-${direction}`))
        throw new Error("unsupported: clue direction mapping");
    const cells = cellsOf(root);
    if (
        new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size !==
        cells.length
    )
        throw new Error("unsupported: duplicate grid coordinates");
    const starts = cells.filter(
        (cell) =>
            cell.node.parentElement
                ?.querySelector(".xlv-cell-num")
                ?.textContent?.trim() === String(number),
    );
    if (starts.length !== 1)
        throw new Error("unsupported: grid number mapping");
    const start = starts[0];
    const line = cells
        .filter((cell) =>
            direction === "across" ? cell.y === start.y : cell.x === start.x,
        )
        .sort((a, b) => (direction === "across" ? a.x - b.x : a.y - b.y));
    const light: Cell[] = [start];
    for (const cell of line.slice(line.indexOf(start) + 1)) {
        const previous = light[light.length - 1];
        const gap =
            direction === "across"
                ? cell.x - previous.x - previous.width
                : cell.y - previous.y - previous.height;
        if (gap < 0 || gap > 2) break;
        light.push(cell);
    }
    const previous = line[line.indexOf(start) - 1];
    if (
        previous &&
        (direction === "across"
            ? start.x - previous.x - previous.width
            : start.y - previous.y - previous.height) <= 2
    )
        throw new Error("unsupported: grid number is not light start");
    const normalized = value.toUpperCase();
    if (light.length !== normalized.length)
        throw new Error("unsupported: answer length mismatch");
    if (light.some((cell, i) => cell.letter && cell.letter !== normalized[i]))
        throw new Error("crossing_conflict: existing letters protected");
    const inputs = root.querySelectorAll<HTMLInputElement>(
        "input.xlv-grid-input",
    );
    const wrappers = root.querySelectorAll<HTMLElement>(
        ".xlv-grid-input-wrapper",
    );
    if (inputs.length !== 1 || wrappers.length !== 1)
        throw new Error("unsupported: Exolve input mapping");
    const input = inputs[0];
    const wrapper = wrappers[0];
    return { root, cells, light, normalized, input, wrapper };
}

function validateGrid(root: Element, cells: Cell[]): void {
    const fresh = cellsOf(root);
    if (
        fresh.length !== cells.length ||
        fresh.some(
            (current, i) =>
                current.node !== cells[i].node ||
                current.rect !== cells[i].rect ||
                current.x !== cells[i].x ||
                current.y !== cells[i].y ||
                current.width !== cells[i].width ||
                current.height !== cells[i].height,
        )
    )
        throw new Error("stale_grid_mapping");
}

function validateFocus(
    binding: CandidateNode,
    input: HTMLInputElement,
    wrapper: HTMLElement,
    cell: Cell,
): void {
    if (
        document.activeElement !== input ||
        !input.isConnected ||
        !binding.node.classList.contains("xlv-active-clue") ||
        parseFloat(wrapper.style.left) !== cell.x ||
        parseFloat(wrapper.style.top) !== cell.y
    )
        throw new Error("wrong_grid_focus");
}

function verifyReadback(
    cells: Cell[],
    light: Cell[],
    index: number,
    normalized: string,
): void {
    if (light[index].node.textContent?.trim() !== normalized[index])
        throw new Error("rendered_readback_failed");
    for (const protectedCell of cells.filter((other) => !light.includes(other)))
        if (
            !protectedCell.node.isConnected ||
            protectedCell.node.textContent?.trim() !== protectedCell.letter
        )
            throw new Error("protected_crossing_changed");
    if (
        light.some(
            (other, i) =>
                other.node.textContent?.trim() !==
                (i <= index ? normalized[i] : other.letter),
        )
    )
        throw new Error("light_readback_failed");
}

export function enterExolve(
    state: Collected,
    binding: CandidateNode,
    value: string,
    number: number,
    direction: CrosswordDirection,
    guard: () => void,
): { entered: number; verified: true } {
    const { root, cells, light, normalized, input, wrapper } = prepareEntry(
        state,
        binding,
        value,
        number,
        direction,
    );
    let entered = 0;
    try {
        guard();
        (binding.node as HTMLElement).click();
        input.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Home",
                keyCode: 36,
                which: 36,
                bubbles: true,
            }),
        );
        input.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "Home",
                keyCode: 36,
                which: 36,
                bubbles: true,
            }),
        );
        for (const [index, cell] of light.entries()) {
            guard();
            validateGrid(root, cells);
            validateFocus(binding, input, wrapper, cell);
            input.value = normalized[index];
            input.dispatchEvent(
                new InputEvent("input", {
                    data: normalized[index],
                    inputType: "insertText",
                    bubbles: true,
                }),
            );
            entered++;
            verifyReadback(cells, light, index, normalized);
        }
        guard();
        if (
            light.map((cell) => cell.node.textContent?.trim()).join("") !==
            normalized
        )
            throw new Error("final_readback_failed");
        return { entered, verified: true };
    } catch (error) {
        throw new Error(
            `partial_entry: ${entered}/${normalized.length}; ${error instanceof Error ? error.message : "verification failed"}; no retry`,
        );
    }
}
