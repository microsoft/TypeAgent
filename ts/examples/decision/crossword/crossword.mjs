import {
    assertFresh,
    decisionObserve,
    explicitAct,
    observeHost,
} from "../web-shopping/observer.mjs";

export function validateRequest(number, direction) {
    if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        !["across", "down"].includes(direction)
    )
        throw new Error("invalid_clue_request");
}

export function createCrosswordActions({ executor, page, client }) {
    async function bind(number, direction) {
        validateRequest(number, direction);
        const snapshot = await observeHost(page, { kind: "crossword" });
        const matches = snapshot.candidates.filter(
            (candidate) =>
                candidate.evidence.number === String(number) &&
                candidate.evidence.direction === direction,
        );
        if (matches.length !== 1)
            throw new Error("missing_or_ambiguous_clue: reobserve");
        const selected = await decisionObserve(
            snapshot,
            client,
            `Which element contains clue ${number} ${direction}?`,
        );
        const candidate = selected?.candidate;
        if (!candidate || candidate !== matches[0])
            throw new Error("no_fit_or_wrong_clue");
        await assertFresh(page, snapshot, candidate);
        return { snapshot, candidate };
    }
    return {
        async getClueValue(number, direction) {
            const { candidate } = await bind(number, direction);
            return page.evaluate(
                ({ selector, number, direction }) => {
                    const clue = document.querySelector(selector);
                    if (
                        !clue ||
                        clue.dataset.clueNumber !== String(number) ||
                        clue.dataset.direction !== direction
                    )
                        throw new Error("stale_clue");
                    return clue.innerText;
                },
                { selector: candidate.action.selector, number, direction },
            );
        },
        async enterText(value, number, direction) {
            if (typeof value !== "string" || !/^[a-zA-Z]+$/.test(value))
                throw new Error(
                    "unsupported_answer: letters only; no implicit punctuation removal",
                );
            const normalized = value.toUpperCase();
            const { snapshot, candidate } = await bind(number, direction);
            const before = await page.evaluate((selector) => {
                const clue = document.querySelector(selector);
                return {
                    cells: [...document.querySelectorAll("[data-cell]")].map(
                        (cell) => ({
                            id: cell.dataset.cell,
                            value: cell.value,
                        }),
                    ),
                    light: clue.dataset.cells?.split(","),
                };
            }, candidate.action.selector);
            if (
                !before.light ||
                before.light.length !== normalized.length ||
                new Set(before.light).size !== before.light.length ||
                before.light.some(
                    (id) => !before.cells.some((cell) => cell.id === id),
                )
            )
                throw new Error("unsupported_grid_mapping_or_answer_length");
            if (
                before.light.some((id, index) => {
                    const previous = before.cells.find(
                        (cell) => cell.id === id,
                    ).value;
                    return previous && previous !== normalized[index];
                })
            )
                throw new Error("crossing_conflict");
            const result = await explicitAct(
                executor,
                page,
                snapshot,
                candidate,
            );
            if (!result.success) throw new Error("clue_click_failed");
            for (const [index, char] of [...normalized].entries()) {
                const focused = await page.evaluate(
                    ({ number, direction, id }) => {
                        const grid = document.querySelector("#grid");
                        return (
                            grid?.dataset.activeNumber === String(number) &&
                            grid.dataset.activeDirection === direction &&
                            document.activeElement ===
                                document.querySelector(`[data-cell="${id}"]`)
                        );
                    },
                    { number, direction, id: before.light[index] },
                );
                if (!focused) throw new Error("wrong_grid_focus");
                await page.keyboard.type(char, { delay: 50 });
            }
            const after = await page.evaluate(() =>
                [...document.querySelectorAll("[data-cell]")].map((cell) => ({
                    id: cell.dataset.cell,
                    value: cell.value,
                })),
            );
            const readback = before.light
                .map((id) => after.find((cell) => cell.id === id)?.value)
                .join("");
            const crossingsIntact = before.cells
                .filter((cell) => !before.light.includes(cell.id))
                .every(
                    (cell) =>
                        after.find((current) => current.id === cell.id)
                            ?.value === cell.value,
                );
            if (readback !== normalized || !crossingsIntact)
                throw new Error("fill_readback_failed");
            return { supplied: value, normalized, readback, crossingsIntact };
        },
    };
}
