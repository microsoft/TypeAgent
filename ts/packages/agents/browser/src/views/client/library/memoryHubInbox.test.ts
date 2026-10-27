// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubInbox } from "./memoryHubInbox";

function setup() {
    const host = document.createElement("section");
    const questions = document.createElement("div");
    const views = document.createElement("div");
    const operations = document.createElement("div");
    document.body.replaceChildren(host);
    const inbox = mountMemoryHubInbox(host, [
        { id: "questions", label: "Question decisions", host: questions },
        { id: "views", label: "Views", host: views },
        { id: "operations", label: "Sources & operations", host: operations },
    ]);
    function add(
        target: HTMLElement,
        title: string,
        summary = "Needs review",
        fingerprint = summary,
    ) {
        const detail = document.createElement("article");
        detail.textContent = `${title}: Full explanation, corpus-opaque-id and provenance. ${"Long evidence. ".repeat(150)}`;
        const action = document.createElement("button");
        action.textContent = "Inspect operation";
        const inspect = jest.fn();
        action.onclick = inspect;
        detail.append(action);
        target.append(
            inbox.present({ id: title, fingerprint, title, summary, detail }),
        );
        return { detail, inspect };
    }
    return { host, inbox, questions, views, operations, add };
}
function button(host: HTMLElement, label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) =>
            element.getAttribute("aria-label") === label ||
            element.textContent === label,
    );
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
}

test("keeps all attention types discoverable with a bounded overview even with 105 view cards", () => {
    const { host, inbox, questions, views, operations, add } = setup();
    add(questions, "Resolve conflicting candidates");
    add(questions, "Review stale answer");
    for (let index = 0; index < 105; index++) add(views, `View ${index}`);
    add(operations, "Failed import");
    inbox.setCount("questions", 5, true);
    inbox.setCount("views", 208, true);
    inbox.setCount("operations", 1);
    expect(host.querySelector(".hub-inbox-tabs")!.classList).toContain(
        "hub-tabs",
    );
    for (const tab of host.querySelectorAll(".hub-inbox-tabs button")) {
        expect(tab.querySelectorAll('i[aria-hidden="true"]')).toHaveLength(1);
    }
    const overview = host.querySelector("#inbox-panel-all")!;
    const viewAllButtons = overview.querySelectorAll<HTMLButtonElement>(
        ".hub-inbox-overview-head button",
    );
    expect(
        [...viewAllButtons].map((control) =>
            control.getAttribute("aria-label"),
        ),
    ).toEqual([
        "View all question decisions",
        "View all views",
        "View all sources & operations",
    ]);
    for (const control of viewAllButtons) {
        expect(control.textContent).toBe("");
        expect(control.classList).toContain("icon-btn");
        expect(control.title).toBe(control.getAttribute("aria-label"));
        expect(control.querySelector("i")!.className).toBe("fa-solid fa-list");
        expect(control.querySelector("i")!.getAttribute("aria-hidden")).toBe(
            "true",
        );
    }
    expect(overview.querySelectorAll(".hub-inbox-item")).toHaveLength(5);
    expect(overview.querySelectorAll("h3")[0].textContent).toContain(
        "Question decisions",
    );
    expect(button(host, "Question decisions (5+)").getAttribute("role")).toBe(
        "tab",
    );
    expect(button(host, "Views (208+)").getAttribute("role")).toBe("tab");
    expect(button(host, "All (214+)").getAttribute("aria-selected")).toBe(
        "true",
    );
    expect(host.querySelector<HTMLElement>("#inbox-panel-views")!.hidden).toBe(
        true,
    );
    button(host, "View all views").click();
    expect(host.querySelector<HTMLElement>("#inbox-panel-views")!.hidden).toBe(
        false,
    );
    expect(views.querySelectorAll(".hub-inbox-item")).toHaveLength(105);
    expect(host.querySelector<HTMLElement>("#inbox-panel-all")!.hidden).toBe(
        true,
    );
});

test("opens full untruncated explanations and working actions only in the details panel", () => {
    const { host, inbox, views, add } = setup();
    const { detail, inspect } = add(views, "Blocked view", "A".repeat(1800));
    inbox.setCount("views", 1);
    const overview = host.querySelector("#inbox-panel-all")!;
    expect(
        overview.querySelector(".hub-inbox-item p")!.textContent,
    ).toHaveLength(180);
    expect(overview.textContent).not.toContain("corpus-opaque-id");
    const review = button(overview as HTMLElement, "Review: Blocked view");
    expect(review.textContent).toBe("");
    expect(review.classList).toContain("icon-btn");
    expect(review.title).toBe("Review: Blocked view");
    expect(review.querySelector("i")!.className).toBe("fa-solid fa-file-lines");
    expect(review.querySelector("i")!.getAttribute("aria-hidden")).toBe("true");
    review.focus();
    review.click();
    const panel = host.querySelector<HTMLElement>(
        'aside[aria-label="Inbox details"]',
    )!;
    expect(panel.hidden).toBe(false);
    expect(panel.contains(detail)).toBe(true);
    expect(panel.textContent).toContain("corpus-opaque-id");
    expect(panel.textContent!.length).toBeGreaterThan(1800);
    button(panel, "Inspect operation").click();
    expect(inspect).toHaveBeenCalledTimes(1);
    button(panel, "Close").click();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(review);
    review.click();
    expect(panel.contains(detail)).toBe(true);
    panel.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(panel.hidden).toBe(true);
});

test("supports arrow, Home and End navigation with one tabbable category", () => {
    const { host } = setup();
    const tabs = host.querySelector<HTMLElement>('[role="tablist"]')!;
    for (const [key, id] of [
        ["ArrowRight", "questions"],
        ["End", "operations"],
        ["ArrowRight", "all"],
        ["ArrowLeft", "operations"],
        ["Home", "all"],
    ]) {
        tabs.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
        );
        const tab = host.querySelector<HTMLButtonElement>(`#inbox-tab-${id}`)!;
        expect(tab.getAttribute("aria-selected")).toBe("true");
        expect(document.activeElement).toBe(tab);
        expect(
            [...tabs.querySelectorAll<HTMLButtonElement>("button")].filter(
                (element) => element.tabIndex === 0,
            ),
        ).toHaveLength(1);
        expect(
            host.querySelector<HTMLElement>(`#inbox-panel-${id}`)!.hidden,
        ).toBe(false);
    }
});
test("count refreshes retain unchanged details but changed or removed selected items invalidate them", () => {
    const { host, inbox, views, add } = setup();
    const { detail, inspect } = add(views, "Blocked view");
    inbox.setCount("views", 1);
    button(
        host.querySelector("#inbox-panel-all")!,
        "Review: Blocked view",
    ).click();
    const panel = host.querySelector<HTMLElement>(
        'aside[aria-label="Inbox details"]',
    )!;
    inbox.setCount("questions", 2);
    inbox.setCount("views", 1);
    inbox.fail("operations", new Error("Unrelated failure"));
    expect(panel.hidden).toBe(false);
    expect(panel.contains(detail)).toBe(true);
    views.replaceChildren();
    add(views, "Blocked view");
    inbox.setCount("views", 1);
    expect(panel.hidden).toBe(false);
    expect(panel.contains(detail)).toBe(true);
    button(panel, "Inspect operation").click();
    expect(inspect).toHaveBeenCalledTimes(1);
    views.replaceChildren();
    add(views, "Blocked view", "Needs review", "changed-version");
    inbox.setCount("views", 1);
    expect(panel.hidden).toBe(true);
    button(
        host.querySelector("#inbox-panel-all")!,
        "Review: Blocked view",
    ).click();
    views.replaceChildren();
    inbox.setCount("views", 0);
    expect(panel.hidden).toBe(true);
});

test("distinguishes loading and errors from empty counts and resets details on scope changes", () => {
    const { host, inbox, views, add } = setup();
    expect(button(host, "Question decisions (...)")).toBeDefined();
    inbox.fail("questions", new Error("Question inventory offline"));
    expect(button(host, "Question decisions (unavailable)")).toBeDefined();
    expect(host.querySelector("#inbox-panel-all")!.textContent).toContain(
        "Question inventory offline",
    );
    inbox.setCount("questions", 0);
    expect(button(host, "Question decisions (0)")).toBeDefined();
    add(views, "Stale view");
    inbox.setCount("views", 1);
    button(
        host.querySelector("#inbox-panel-all")!,
        "Review: Stale view",
    ).click();
    inbox.reset();
    expect(host.querySelector<HTMLElement>("aside")!.hidden).toBe(true);
    expect(button(host, "All (...)").getAttribute("aria-selected")).toBe(
        "true",
    );
    expect(button(host, "Views (...)")).toBeDefined();
    expect(views.hidden).toBe(true);
    expect(views.querySelector(".hub-inbox-item")).toBeNull();
    expect(host.querySelector("#inbox-panel-all")!.textContent).not.toContain(
        "Stale view",
    );
});
