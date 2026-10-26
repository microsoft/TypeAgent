// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @jest-environment jsdom */
import { MemoryHubInventoryPager } from "./memoryHubInventoryPager";

test("bounded per-collection pages traverse exhausted collections and restore previous tokens", () => {
    const pager = new MemoryHubInventoryPager();
    const reload = jest.fn();
    expect(pager.request("a")).toEqual({ corpusId: "a", pageSize: 25 });
    pager.update([
        { corpusId: "a", total: 60, nextContinuationToken: "25" },
        { corpusId: "b", total: 3 },
    ]);
    expect(pager.total).toBe(63);
    const controls = pager.controls("views", reload);
    const next = controls.querySelector<HTMLButtonElement>(
        '[aria-label="Next views page"]',
    )!;
    next.click();
    next.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(pager.request("a")).toEqual({
        corpusId: "a",
        pageSize: 25,
        continuationToken: "25",
    });
    expect(pager.includes("b")).toBe(false);
    pager.update([{ corpusId: "a", total: 60, nextContinuationToken: "50" }]);
    pager
        .controls("views", reload)
        .querySelector<HTMLButtonElement>('[aria-label="Next views page"]')!
        .click();
    pager.update([{ corpusId: "a", total: 60 }]);
    expect(pager.hasNext).toBe(false);
    expect(pager.total).toBe(63);
    pager
        .controls("views", reload)
        .querySelector<HTMLButtonElement>('[aria-label="Previous views page"]')!
        .click();
    expect(pager.request("a").continuationToken).toBe("25");
    expect(pager.includes("b")).toBe(false);
    pager
        .controls("views", reload)
        .querySelector<HTMLButtonElement>('[aria-label="Previous views page"]')!
        .click();
    expect(pager.request("a")).toEqual({ corpusId: "a", pageSize: 25 });
    expect(pager.includes("b")).toBe(true);
    pager.reset();
    expect(pager.total).toBe(0);
    expect(pager.hasNext).toBe(false);
    expect(
        pager
            .controls("views", reload)
            .querySelector<HTMLButtonElement>(
                '[aria-label="Previous views page"]',
            )!.disabled,
    ).toBe(true);
});
