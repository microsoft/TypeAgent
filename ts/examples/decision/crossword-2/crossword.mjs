import {
    decisionObserve,
    makeSnapshot,
    requireLocal,
} from "../web-shopping/observer.mjs";
import { validateRequest } from "../crossword/crossword.mjs";

export function prepareEntry(value, cells, light) {
    if (typeof value !== "string" || !/^[a-zA-Z]+$/.test(value))
        throw new Error("unsupported_answer: letters only");
    const normalized = value.toUpperCase();
    if (
        !Array.isArray(light) ||
        light.length !== normalized.length ||
        new Set(light).size !== light.length ||
        light.some((id) => !Object.hasOwn(cells, id))
    )
        throw new Error("unsupported_grid_mapping_or_answer_length");
    if (light.some((id, index) => cells[id] && cells[id] !== normalized[index]))
        throw new Error("crossing_conflict");
    return normalized;
}

export function verifyEntry(before, after, light, normalized) {
    const readback = light.map((id) => after[id] ?? "").join("");
    const crossingsIntact = Object.entries(before)
        .filter(([id]) => !light.includes(id))
        .every(([id, value]) => after[id] === value);
    if (readback !== normalized || !crossingsIntact)
        throw new Error("fill_readback_failed");
    return { normalized, readback, crossingsIntact };
}

export async function observeExolve(page) {
    requireLocal(page.url());
    const observed = await page.evaluate(() => {
        const puzzles = Object.values(globalThis.exolvePuzzles ?? {}).filter(
            (puzzle) => Array.isArray(puzzle?.grid),
        );
        if (puzzles.length !== 1)
            throw new Error("unsupported_or_ambiguous_engine");
        const puzzle = puzzles[0];
        const state = (globalThis.__crossword2 ??= {
            revision: 0,
            nodes: new Map(),
        });
        if (!state.observer) {
            state.observer = new MutationObserver(() => state.revision++);
            const frame = document.querySelector(".xlv-frame");
            if (!frame) throw new Error("renderer_not_ready");
            state.observer.observe(frame, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
            });
        }
        state.token = crypto.randomUUID();
        state.puzzle = puzzle;
        state.nodes.clear();
        const candidates = Object.values(puzzle.clues)
            .filter(
                (clue) =>
                    ["A", "D"].includes(clue.dir) &&
                    /^\d+$/.test(clue.label) &&
                    clue.clueTR?.isConnected &&
                    clue.clueSpan?.isConnected &&
                    clue.cells?.length,
            )
            .map((clue, index) => {
                const node = clue.clueTR;
                const ref = `${state.token}-${index}`;
                node.dataset.crossword2Ref = ref;
                state.nodes.set(index, { node, clue });
                return {
                    identity: index,
                    evidence: {
                        number: clue.label,
                        direction: clue.dir === "A" ? "across" : "down",
                        text: clue.clueSpan.innerText,
                        length: clue.cells.length,
                    },
                    action: {
                        selector: `[data-crossword2-ref="${ref}"]`,
                        method: "click",
                        arguments: [],
                        description: clue.clueSpan.innerText,
                    },
                };
            });
        if (state.observer.takeRecords().length) state.revision++;
        return {
            candidates,
            revision: state.revision,
            documentToken: state.token,
            puzzleId: puzzle.id,
        };
    });
    return {
        ...observed,
        ...makeSnapshot(observed.candidates, observed.revision),
    };
}

async function inspect(page, snapshot, candidate) {
    requireLocal(page.url());
    return page.evaluate(
        ({ documentToken, revision, identity, evidence, selector }) => {
            const state = globalThis.__crossword2;
            const binding = state?.nodes.get(identity);
            const puzzle = state?.puzzle;
            if (
                !binding ||
                state.token !== documentToken ||
                state.revision !== revision ||
                !binding.node.isConnected ||
                document.querySelectorAll(selector).length !== 1 ||
                document.querySelector(selector) !== binding.node ||
                !binding.node.getClientRects().length ||
                binding.clue.clueSpan.innerText !== evidence.text ||
                String(binding.clue.label) !== evidence.number ||
                (binding.clue.dir === "A" ? "across" : "down") !==
                    evidence.direction
            )
                throw new Error("stale_target: reobserve");
            const cells = {};
            for (const [row, line] of puzzle.grid.entries())
                for (const [col, cell] of line.entries())
                    if (cell.isLight)
                        cells[`${row},${col}`] =
                            cell.textNode?.nodeValue?.trim() ?? "";
            return {
                cells,
                light: binding.clue.cells.map((cell) => cell.join(",")),
                clueIndex: binding.clue.index,
                text: binding.clue.clueSpan.innerText,
            };
        },
        {
            documentToken: snapshot.documentToken,
            revision: snapshot.revision,
            identity: candidate.identity,
            evidence: candidate.evidence,
            selector: candidate.action.selector,
        },
    );
}

export function createCrosswordActions({ page, client, executor }) {
    async function bind(number, direction) {
        validateRequest(number, direction);
        const snapshot = await observeExolve(page);
        const matches = snapshot.candidates.filter(
            ({ evidence }) =>
                evidence.number === String(number) &&
                evidence.direction === direction,
        );
        if (matches.length !== 1) throw new Error("missing_or_ambiguous_clue");
        const selected = await decisionObserve(
            snapshot,
            client,
            `Which element contains clue ${number} ${direction}?`,
        );
        if (selected?.candidate !== matches[0])
            throw new Error("no_fit_or_wrong_clue");
        return {
            snapshot,
            candidate: matches[0],
            before: await inspect(page, snapshot, matches[0]),
        };
    }
    return {
        async getClueValue(number, direction) {
            return (await bind(number, direction)).before.text;
        },
        async enterText(value, number, direction) {
            const { snapshot, candidate, before } = await bind(
                number,
                direction,
            );
            const normalized = prepareEntry(value, before.cells, before.light);
            await inspect(page, snapshot, candidate);
            const result = await executor.act(candidate.action, { page });
            if (!result.success) throw new Error("clue_click_failed");
            await page.keyboard.press("Home");
            for (const [index, char] of [...normalized].entries()) {
                const focused = await page.evaluate(
                    ({ id, clueIndex }) => {
                        const puzzle = globalThis.__crossword2.puzzle;
                        return (
                            document.activeElement === puzzle.gridInput &&
                            `${puzzle.currRow},${puzzle.currCol}` === id &&
                            puzzle.currClueIndex === clueIndex
                        );
                    },
                    { id: before.light[index], clueIndex: before.clueIndex },
                );
                if (!focused) throw new Error("wrong_grid_focus");
                await page.keyboard.type(char, { delay: 80 });
            }
            const after = await page.evaluate(() => {
                const cells = {};
                for (const [
                    row,
                    line,
                ] of globalThis.__crossword2.puzzle.grid.entries())
                    for (const [col, cell] of line.entries())
                        if (cell.isLight)
                            cells[`${row},${col}`] =
                                cell.textNode?.nodeValue?.trim() ?? "";
                return cells;
            });
            return {
                supplied: value,
                ...verifyEntry(before.cells, after, before.light, normalized),
            };
        },
    };
}
