// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewKind, ViewSummaryRequest } from "@typeagent/memory-service";
import {
    createViewTypeFilter,
    findPopulatedViewKinds,
    type ViewTypeOption,
} from "./memoryHubViewTypeFilter";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const options: ViewTypeOption[] = [
    { label: "All", icon: "fa-layer-group" },
    { kind: "wiki", label: "Knowledge Wiki", icon: "fa-book-open" },
    {
        kind: "projectBrief",
        label: "Project Brief",
        icon: "fa-diagram-project",
    },
    { kind: "timeline", label: "Timeline", icon: "fa-timeline" },
    { kind: "extension", label: "User-defined views", icon: "fa-layer-group" },
];

describe("adaptive view-type filter", () => {
    let width: number;
    let filter: ReturnType<typeof createViewTypeFilter>;
    let selected: jest.Mock;
    const primary = () =>
        [...filter.element.children]
            .filter(
                (child): child is HTMLButtonElement =>
                    child instanceof HTMLButtonElement,
            )
            .filter((button) => !button.hidden)
            .map((button) => button.textContent);
    const trigger = () =>
        filter.element.querySelector<HTMLButtonElement>(
            '[aria-haspopup="menu"]',
        )!;
    const entries = () => [
        ...filter.element.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
        ),
    ];
    function mount(
        populated: ViewKind[] = ["wiki", "projectBrief", "extension"],
    ) {
        filter = createViewTypeFilter(
            options,
            new Set(populated),
            undefined,
            selected,
        );
        document.body.append(filter.element);
        filter.layout();
    }
    function resize(value: number) {
        width = value;
        window.dispatchEvent(new Event("resize"));
    }
    beforeEach(() => {
        width = 1000;
        selected = jest.fn();
        document.body.replaceChildren();
        jest.spyOn(
            HTMLElement.prototype,
            "getBoundingClientRect",
        ).mockImplementation(function (this: HTMLElement) {
            const measured = this.classList.contains("hub-view-type-tabs")
                ? width
                : this.classList.contains("hub-menu-host")
                  ? 40
                  : this.textContent === "All"
                    ? 48
                    : 100;
            return {
                x: 0,
                y: 0,
                left: 0,
                top: 0,
                right: measured,
                bottom: 36,
                width: measured,
                height: 36,
                toJSON: () => ({}),
            };
        });
    });
    afterEach(() => {
        filter?.dispose();
        jest.restoreAllMocks();
    });

    test("only populated types appear as primary filters", () => {
        mount();
        expect(primary()).toEqual([
            "All",
            "Knowledge Wiki",
            "Project Brief",
            "User-defined views",
        ]);
        expect(trigger().querySelector("i")!.className).toContain(
            "fa-ellipsis-vertical",
        );
        trigger().click();
        expect(entries().map((entry) => entry.textContent)).toEqual([
            "Timeline",
        ]);
    });

    test("an empty collection retains All and all other supported types in overflow", () => {
        mount([]);
        expect(primary()).toEqual(["All"]);
        trigger().click();
        expect(entries()).toHaveLength(4);
    });

    test("selecting an empty type exposes its selected state without promoting it", () => {
        mount();
        trigger().click();
        entries()[0].click();
        expect(selected).toHaveBeenLastCalledWith("timeline");
        expect(primary()).not.toContain("Timeline");
        expect(trigger().getAttribute("aria-pressed")).toBe("true");
        expect(trigger().getAttribute("aria-label")).toContain(
            "Timeline selected",
        );
        expect(document.activeElement).toBe(trigger());
        trigger().click();
        expect(entries()[0].getAttribute("aria-checked")).toBe("true");
    });

    test("narrow layouts overflow populated types and promote a selected type when it fits", () => {
        mount();
        resize(250);
        expect(primary()).toEqual(["All", "Knowledge Wiki"]);
        trigger().click();
        expect(entries().map((entry) => entry.textContent)).toEqual([
            "Project Brief",
            "Timeline",
            "User-defined views",
        ]);
        entries()[0].click();
        expect(primary()).toEqual(["All", "Project Brief"]);
        expect(document.activeElement?.textContent).toBe("Project Brief");
        resize(1000);
        expect(primary()).toEqual([
            "All",
            "Knowledge Wiki",
            "Project Brief",
            "User-defined views",
        ]);
    });

    test("a selected type that cannot fit remains selected in overflow", () => {
        mount();
        filter.element
            .querySelectorAll<HTMLButtonElement>(":scope > button")[1]
            .click();
        resize(140);
        expect(primary()).toEqual(["All"]);
        expect(trigger().getAttribute("aria-label")).toContain(
            "Knowledge Wiki selected",
        );
        expect(document.activeElement).toBe(trigger());
    });

    test("hides the overflow trigger when every supported type is populated and fits", () => {
        mount(["wiki", "projectBrief", "timeline", "extension"]);
        expect(trigger().parentElement!.hidden).toBe(true);
        resize(250);
        expect(trigger().parentElement!.hidden).toBe(false);
    });

    test("widening restores selected filter focus when the overflow trigger disappears", () => {
        mount(["wiki", "projectBrief", "timeline", "extension"]);
        const wiki = [...filter.element.children].find(
            (child): child is HTMLButtonElement =>
                child instanceof HTMLButtonElement &&
                child.textContent === "Knowledge Wiki",
        )!;
        wiki.click();
        resize(140);
        expect(document.activeElement).toBe(trigger());
        resize(1000);
        expect(trigger().parentElement!.hidden).toBe(true);
        expect(document.activeElement).toBe(wiki);
    });

    test("keyboard opening, arrow navigation, Home, End and Escape preserve focus", () => {
        mount([]);
        trigger().focus();
        trigger().dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
        expect(document.activeElement).toBe(entries()[0]);
        entries()[0].dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
        expect(document.activeElement).toBe(entries().at(-1));
        entries()
            .at(-1)!
            .dispatchEvent(
                new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
            );
        expect(document.activeElement).toBe(entries()[0]);
        entries()[0].dispatchEvent(
            new KeyboardEvent("keydown", { key: "End", bubbles: true }),
        );
        expect(document.activeElement).toBe(entries().at(-1));
        entries()
            .at(-1)!
            .dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
        expect(entries()).toHaveLength(0);
        expect(document.activeElement).toBe(trigger());
    });

    test("resizing does not steal focus from outside the filters", () => {
        mount();
        const search = document.createElement("input");
        document.body.append(search);
        search.focus();
        resize(140);
        expect(document.activeElement).toBe(search);
    });

    test("disposal closes menus and removes resize listeners", () => {
        mount([]);
        trigger().click();
        filter.dispose();
        expect(entries()).toHaveLength(0);
        const measure = jest.spyOn(filter.element, "getBoundingClientRect");
        measure.mockClear();
        resize(140);
        expect(measure).not.toHaveBeenCalled();
    });
});

describe("view-type presence outside filtered or paginated results", () => {
    beforeEach(() => invoke.mockReset());

    test("probes only unseen types, includes drafts and checks the whole collection scope", async () => {
        invoke.mockImplementation(async (_method, params) => {
            const request = params as ViewSummaryRequest;
            return {
                items:
                    request.corpusId === "second" &&
                    request.kind === "projectBrief"
                        ? [{ content: { kind: "projectBrief" } }]
                        : [],
            };
        });
        const found = await findPopulatedViewKinds(
            ["first", "second"],
            ["wiki", "projectBrief", "timeline"],
            new Set(["wiki"]),
        );
        expect([...found]).toEqual(["wiki", "projectBrief"]);
        expect(invoke).toHaveBeenCalledTimes(4);
        for (const [method, request] of invoke.mock.calls) {
            expect(method).toBe("memoryListViewSummaries");
            expect(request).toEqual({
                corpusId: expect.any(String),
                kind: expect.any(String),
                includeDrafts: true,
                pageSize: 1,
            });
        }
    });

    test("does not claim absence when an inventory probe fails", async () => {
        invoke.mockRejectedValue(new Error("Inventory unavailable"));
        await expect(
            findPopulatedViewKinds(["c"], ["wiki"], new Set()),
        ).rejects.toThrow("Inventory unavailable");
    });
});
