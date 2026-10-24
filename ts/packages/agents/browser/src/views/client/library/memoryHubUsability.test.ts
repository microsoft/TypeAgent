// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubQuestions } from "./memoryHubQuestions";
import { invokeMemory, invokeView } from "./viewClient";
import { question } from "./memoryHubQuestionsTestData";
import { mountMemoryHubViewActivity } from "./memoryHubViewActivity";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock;
void invokeView;

async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

function isVisible(node: Element): boolean {
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement && !parent.open) {
            const summary = node.closest("summary");
            if (!summary || summary.parentElement !== parent) return false;
        }
    return true;
}

function words(node: Element): Set<string> {
    return new Set(
        (node.textContent ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [],
    );
}

// Default-screen checks from the usability review (A1-A5, A7).
function visibleWords(root: HTMLElement): number {
    let count = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && isVisible(parent) && !parent.closest("script, style"))
            count +=
                (node.textContent ?? "").match(/[A-Za-z0-9]+/g)?.length ?? 0;
    }
    return count;
}

function audit(root: HTMLElement, wordBudget: number): string[] {
    const problems: string[] = [];

    // A6: visible words stay within the screen's budget.
    const total = visibleWords(root);
    if (total > wordBudget)
        problems.push(`A6 ${total} visible words exceeds ${wordBudget}`);

    // A8: no visible JSON field or explanatory paragraph on a default screen.
    for (const field of root.querySelectorAll("label")) {
        if (isVisible(field) && /JSON/.test(field.textContent ?? ""))
            problems.push(`A8 visible JSON field: ${field.textContent}`);
    }
    for (const paragraph of root.querySelectorAll("p"))
        if (
            isVisible(paragraph) &&
            (paragraph.textContent ?? "").split(/\s+/).length > 30
        )
            problems.push("A8 long explanatory paragraph");

    const controls = [...root.querySelectorAll("button, a")].filter(isVisible);

    // A1: a control's label does not repeat the heading of its container.
    for (const control of controls) {
        const label = (
            control.textContent || control.getAttribute("aria-label")
        )?.toLowerCase();
        if (!label) continue;
        for (
            let parent = control.parentElement;
            parent && parent !== root;
            parent = parent.parentElement
        ) {
            const heading = parent.querySelector(":scope > h3, :scope > h4");
            const text = heading?.textContent?.trim().toLowerCase();
            if (text && text.length > 3 && label.includes(text))
                problems.push(`A1 label repeats heading: ${label}`);
        }
    }

    // A2: at most one text button and two icon buttons per action row.
    for (const row of root.querySelectorAll(".hub-row-actions")) {
        if (!isVisible(row)) continue;
        const buttons = [...row.querySelectorAll(":scope > button")];
        const icons = buttons.filter((button) =>
            button.classList.contains("icon-btn"),
        );
        if (buttons.length - icons.length > 1 || icons.length > 2)
            problems.push(
                `A2 row has ${buttons.length - icons.length} text and ${icons.length} icon buttons`,
            );
    }

    // A3: no raw JSON or preformatted blocks on a default screen.
    for (const block of root.querySelectorAll("pre"))
        if (isVisible(block)) problems.push("A3 visible <pre> block");

    // A4: sibling cards do not mostly repeat each other.
    for (const container of root.querySelectorAll("*")) {
        const cards = [...container.children].filter(
            (child) => child.classList.contains("card") && isVisible(child),
        );
        for (let i = 0; i < cards.length; i++)
            for (let j = i + 1; j < cards.length; j++) {
                const a = words(cards[i]);
                const b = words(cards[j]);
                const shared = [...a].filter((word) => b.has(word)).length;
                if (a.size > 6 && shared / Math.min(a.size, b.size) > 0.6)
                    problems.push("A4 sibling cards repeat content");
            }
    }

    // A5: at most two status chips per row.
    for (const chips of root.querySelectorAll(".hub-chips")) {
        const count = chips.querySelectorAll(":scope > .hub-chip").length;
        if (isVisible(chips) && count > 2)
            problems.push(`A5 ${count} chips in one row`);
    }

    // A7: icon-only controls have a tooltip and an accessible name.
    for (const control of root.querySelectorAll("button.icon-btn")) {
        if (
            !control.getAttribute("aria-label") ||
            !control.getAttribute("title")
        )
            problems.push("A7 icon button without name or tooltip");
    }
    return problems;
}

function setup() {
    document.body.innerHTML = "<main></main><aside></aside>";
    return mountMemoryHubQuestions(
        document.querySelector("main")!,
        document.querySelector("aside")!,
        {
            scope: () => "corpus",
            corpora: () => [{ corpusId: "corpus", name: "Corpus" }],
            hidden: {},
            persistHidden: jest.fn(),
            onError: jest.fn(),
            onOpenSource: jest.fn(),
        },
    );
}

function withCandidate() {
    const current = question();
    const citation = {
        sourceId: "source",
        revisionId: "revision",
        locator: "chars:0-3",
        excerpt: "Ada",
    };
    current.details.candidates.push({
        id: "candidate",
        value: "Ada",
        origin: "source",
        review: "unreviewed",
        citations: [citation],
        opposingCitations: [],
        derivedFrom: [],
        support: [{ citation, derivedFrom: [] }],
    });
    return current;
}

beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        if (method === "memoryListQuestions")
            return { head: "head", items: [withCandidate()] };
        if (method === "memoryListAcquisitions") return [];
        throw new Error(`Unexpected operation ${method}`);
    });
});

test("the questions list passes the default-screen usability audit", async () => {
    const panel = setup();
    await panel.show();
    expect(audit(document.body, 150)).toEqual([]);
});

test("question detail passes the audit and hides raw JSON until Advanced is opened", async () => {
    const panel = setup();
    await panel.show();
    [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "What is the name?")!
        .click();
    await settle();
    expect(audit(document.body, 250)).toEqual([]);
    const advanced = [
        ...document.querySelectorAll(
            '[aria-label="Question inspector"] > details',
        ),
    ].find(
        (details) =>
            details.querySelector("summary")?.textContent === "Advanced",
    )!;
    expect((advanced as HTMLDetailsElement).open).toBe(false);
    expect(advanced.querySelector("pre")).not.toBeNull();
});

test("a candidate offers only the review actions that change its state", async () => {
    const panel = setup();
    await panel.show();
    [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "What is the name?")!
        .click();
    await settle();
    const labels = [
        ...document.querySelectorAll('.card button[aria-label$="candidate"]'),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Confirm candidate", "Reject candidate"]);
});

function failedJob() {
    const definition = {
        kind: "wiki" as const,
        viewId: "wiki",
        selector: { kind: "sources" as const, sources: [] },
    };
    return {
        jobId: "job-1",
        corpusId: "alpha",
        fingerprint: "f",
        request: {
            corpusId: "alpha",
            expectedHead: null,
            targets: [{ definition, expectedVersion: 0 }],
        },
        actor: "fixture",
        createdAt: "2026-10-09T12:00:00Z",
        updatedAt: "2026-10-09T12:01:00Z",
        state: "partial",
        publication: false,
        results: [
            {
                viewId: "wiki",
                state: "failed",
                reason: "Model configuration rejected",
                snapshot: {
                    corpusId: "alpha",
                    actor: "fixture",
                    definition,
                    expectedVersion: 0,
                    bounds: {},
                    inputs: [],
                    pipeline: "informational-wiki-v1",
                    model: "fixture",
                    fingerprint: "f",
                },
            },
        ],
    };
}

test("Activity and its attention cards pass the audit", async () => {
    invoke.mockImplementation(async (method: string) => {
        switch (method) {
            case "memoryViewCapabilities":
                return { derivedViews: { builds: true } };
            case "memoryListCorpora":
                return [{ corpusId: "alpha", name: "Alpha" }];
            case "memoryListViewBuilds":
            case "memoryGetViewBuild":
                return method === "memoryListViewBuilds"
                    ? [failedJob()]
                    : failedJob();
            case "memoryListViews":
                return { head: null, views: [] };
            default:
                throw new Error(`Unexpected method ${method}`);
        }
    });
    const host = document.createElement("div");
    const attention = document.createElement("div");
    document.body.replaceChildren(host, attention);
    const mounted = mountMemoryHubViewActivity(host, attention, {
        scope: () => "alpha",
        onError: jest.fn(),
        onOpenView: jest.fn(),
        onOpenBuild: jest.fn(),
    });
    await mounted.show({ corpusId: "alpha", jobId: "job-1" });
    expect(audit(attention, 120)).toEqual([]);
    expect(audit(host, 250)).toEqual([]);
    expect(attention.querySelector("h3")?.title).toContain("Current view");
    mounted.dispose();
});

test("an unknown question can be snoozed or dismissed from its detail", async () => {
    const hidden: Record<string, unknown> = {};
    document.body.innerHTML = "<main></main><aside></aside>";
    const panel = mountMemoryHubQuestions(
        document.querySelector("main")!,
        document.querySelector("aside")!,
        {
            scope: () => "corpus",
            corpora: () => [{ corpusId: "corpus", name: "Corpus" }],
            hidden,
            persistHidden: jest.fn(),
            onError: jest.fn(),
            onOpenSource: jest.fn(),
        },
    );
    await panel.show();
    [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "What is the name?")!
        .click();
    document
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!
        .click();
    expect(Object.keys(hidden)).toHaveLength(1);
});

test("the audit flags the patterns it is meant to catch", () => {
    document.body.innerHTML = `
        <article class="card">
            <h4>Resolve the launch date</h4>
            <div class="hub-row-actions">
                <button>Review Resolve the launch date</button>
                <button>Snooze</button>
            </div>
            <label>Rubric (JSON)<textarea></textarea></label>
            <pre>{}</pre>
            <div class="hub-chips"><span class="hub-chip">a</span><span class="hub-chip">b</span><span class="hub-chip">c</span></div>
            <button class="icon-btn"></button>
        </article>`;
    const problems = audit(document.body, 5).join("\n");
    for (const code of ["A1", "A2", "A3", "A5", "A6", "A7", "A8"])
        expect(problems).toContain(code);
});
