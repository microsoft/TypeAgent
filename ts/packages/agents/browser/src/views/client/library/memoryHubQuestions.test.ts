// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryFixture } from "./memoryHubInventoryTestData";

import { mountMemoryHubQuestions } from "./memoryHubQuestions";
import { invokeMemory, invokeView } from "./viewClient";
import { question } from "./memoryHubQuestionsTestData";
import { rbMarkdown } from "./memoryHubDocumentUi";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock;
const viewInvoke = invokeView as jest.Mock;
async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}
function click(label: string) {
    const target = [...document.querySelectorAll("button")].find(
        (button) =>
            button.textContent === label ||
            button.getAttribute("aria-label") === label,
    );
    if (!target) throw new Error(`Missing button ${label}`);
    target.click();
}
function setup(
    scope: () => string | undefined = () => "corpus",
    onNavigate?: Parameters<typeof mountMemoryHubQuestions>[2]["onNavigate"],
    corpora = [{ corpusId: "corpus", name: "Corpus" }],
) {
    document.body.innerHTML = "<main></main><aside></aside>";
    const onError = jest.fn();
    return {
        onError,
        panel: mountMemoryHubQuestions(
            document.querySelector("main")!,
            document.querySelector("aside")!,
            {
                scope,
                corpora: () => corpora,
                hidden: {},
                persistHidden: jest.fn(),
                onError,
                onOpenSource: jest.fn(),
                onNavigate,
            },
        ),
    };
}
beforeEach(() => {
    invoke.mockReset();
    viewInvoke.mockReset();
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { kinds: ["schemaView"] } };
            if (method === "memoryListQuestions")
                return { head: "head", items: [question()] };
            if (method === "memoryEditQuestion") return {};
            throw new Error(`Unexpected operation ${method}`);
        }),
    );
});
test("question cards navigate to a corpus-qualified slot reader and Back restores the list route", async () => {
    const onNavigate = jest.fn();
    const { panel, onError } = setup(() => "corpus", onNavigate);
    await panel.show();
    click("What is the name?");
    expect(onNavigate).toHaveBeenLastCalledWith({
        page: "questions",
        corpusId: "corpus",
        objectId: "view",
        questionSlotId: "slot",
    });
    await panel.show("view", "corpus", "slot");
    const reader = document.querySelector<HTMLElement>(".hub-question-reader")!;
    expect(reader.hidden).toBe(false);
    expect(
        document.querySelector<HTMLElement>('[aria-label="Questions list"]')!
            .hidden,
    ).toBe(true);
    const overview = reader.querySelector(
        'aside[aria-label="About this question"]',
    )!;
    expect(overview.classList).toContain("hub-view-infobox");
    expect(overview.textContent).toContain("Coverage unknown");
    expect(overview.textContent).toContain("Version 2");
    expect(reader.querySelector(".hub-question-content")).not.toBeNull();
    click("Back to questions");
    expect(onNavigate).toHaveBeenLastCalledWith({ page: "questions" });
    await panel.show();
    expect(reader.hidden).toBe(true);
    expect(
        document.querySelector<HTMLElement>('[aria-label="Questions list"]')!
            .hidden,
    ).toBe(false);
    expect(onError).not.toHaveBeenCalled();
});

test("direct question links load the exact slot without searching every collection or inventory page", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetQuestion"
            ? Promise.resolve(question("off-page"))
            : original(method, params),
    );
    const { panel, onError } = setup();
    await panel.show("view", "corpus", "off-page");
    expect(invoke).toHaveBeenCalledWith("memoryGetQuestion", {
        corpusId: "corpus",
        viewId: "view",
        slotId: "off-page",
    });
    expect(invoke).toHaveBeenCalledWith("memoryListQuestionSummaries", {
        corpusId: "corpus",
        viewId: "view",
        pageSize: 1,
    });
    expect(document.querySelector(".hub-view-infobox")!.textContent).toContain(
        "Coverage unknown",
    );
    const answer = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Question inspector"] textarea',
    )!;
    answer.value = '"Ada"';
    answer.dispatchEvent(new Event("input"));
    click("Save user assertion");
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memoryEditQuestion",
        expect.objectContaining({
            slotId: "off-page",
            expectedHead: "head",
            expectedVersion: 2,
        }),
    );
    expect(document.querySelector(".hub-view-infobox")).not.toBeNull();
    expect(onError).not.toHaveBeenCalled();
});

test("Back invalidates pending question details and operation errors stay visible on the reader", async () => {
    const { panel } = setup();
    await panel.show();
    const original = invoke.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetQuestion"
            ? new Promise((done) => {
                  resolve = done;
              })
            : original(method, params),
    );
    click("What is the name?");
    click("Back to questions");
    resolve(question());
    await settle();
    expect(
        document.querySelector<HTMLElement>(".hub-question-reader")!.hidden,
    ).toBe(true);
    expect(document.querySelector(".hub-qdetail")!.textContent).toBe("");
    invoke.mockImplementation(original);
    click("What is the name?");
    await settle();
    invoke.mockImplementation((method, params) =>
        method === "memoryEditQuestion"
            ? Promise.reject(new Error("Edit rejected"))
            : original(method, params),
    );
    const answer = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Question inspector"] textarea',
    )!;
    answer.value = '"Ada"';
    answer.dispatchEvent(new Event("input"));
    click("Save user assertion");
    await settle();
    expect(
        document.querySelector(".hub-qdetail [role=alert]")!.textContent,
    ).toContain("Edit rejected");
});
test("a new slot route removes old edit controls before loading and after a detail failure", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetQuestion"
            ? Promise.resolve(question(params.slotId))
            : original(method, params),
    );
    const { panel, onError } = setup();
    await panel.show("view", "corpus", "first");
    expect(document.querySelector(".hub-qdetail textarea")).not.toBeNull();
    let reject!: (error: Error) => void;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetQuestion"
            ? new Promise((_resolve, fail) => {
                  reject = fail;
              })
            : original(method, params),
    );
    const pending = panel.show("view", "corpus", "second");
    expect(document.querySelector(".hub-qdetail")!.textContent).toContain(
        "Loading question details",
    );
    expect(document.querySelector(".hub-qdetail textarea")).toBeNull();
    expect(document.querySelectorAll(".hub-qdetail h2")).toHaveLength(1);
    reject(new Error("Second slot unavailable"));
    await pending;
    expect(document.querySelector(".hub-qdetail")!.textContent).toContain(
        "Second slot unavailable",
    );
    expect(document.querySelector(".hub-qdetail textarea")).toBeNull();
    expect(document.querySelector(".hub-qdetail")!.textContent).not.toContain(
        "Save user assertion",
    );
    expect(document.querySelectorAll(".hub-qdetail h2")).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
});

test("cross-collection readers refresh their own edit head independently of the list scope", async () => {
    const original = invoke.getMockImplementation()!;
    let version = 2;
    invoke.mockImplementation((method, params) => {
        if (method === "memoryGetQuestion")
            return Promise.resolve({
                ...question("slot", "view-b"),
                corpusId: "b",
                viewVersion: version,
            });
        if (method === "memoryListQuestionSummaries" && params.corpusId === "b")
            return Promise.resolve({
                head: `b-head-${version}`,
                items: [],
                total: 0,
            });
        if (method === "memoryEditQuestion") {
            version++;
            return Promise.resolve({});
        }
        return original(method, params);
    });
    const navigate = jest.fn();
    const { panel, onError } = setup(() => "a", navigate, [
        { corpusId: "a", name: "Alpha" },
        { corpusId: "b", name: "Beta" },
    ]);
    await panel.show("view-b", "b", "slot");
    for (const answer of ['"First"', '"Second"']) {
        const editor = document.querySelector<HTMLTextAreaElement>(
            ".hub-qdetail textarea",
        )!;
        editor.value = answer;
        editor.dispatchEvent(new Event("input"));
        click("Save user assertion");
        await settle();
    }
    expect(
        invoke.mock.calls
            .filter(([method]) => method === "memoryEditQuestion")
            .map(([, params]) => ({
                corpusId: params.corpusId,
                head: params.expectedHead,
                version: params.expectedVersion,
            })),
    ).toEqual([
        { corpusId: "b", head: "b-head-2", version: 2 },
        { corpusId: "b", head: "b-head-3", version: 3 },
    ]);
    expect(
        invoke.mock.calls
            .filter(([method]) => method === "memoryListQuestionSummaries")
            .every(
                ([, params]) =>
                    params.corpusId === "b" && params.pageSize === 1,
            ),
    ).toBe(true);
    click("Back to questions");
    expect(navigate).toHaveBeenCalledWith({ page: "questions" });
    expect(onError).not.toHaveBeenCalled();
});

test("busy question operations reject navigation and background refresh preserves unsaved drafts", async () => {
    const { panel, onError } = setup();
    await panel.show("view", "corpus", "slot");
    const editor = document.querySelector<HTMLTextAreaElement>(
        ".hub-qdetail textarea",
    )!;
    editor.value = '"Draft"';
    editor.dispatchEvent(new Event("input"));
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    await panel.refresh();
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector(".hub-qdetail textarea")).toBe(editor);
    expect(editor.value).toBe('"Draft"');
    const original = invoke.getMockImplementation()!;
    let finish!: () => void;
    invoke.mockImplementation((method, params) =>
        method === "memoryEditQuestion"
            ? new Promise<void>((resolve) => {
                  finish = resolve;
              })
            : original(method, params),
    );
    click("Save user assertion");
    expect(panel.discardChanges()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await panel.refresh();
    expect(document.querySelector(".hub-qdetail textarea")).toBe(editor);
    expect(confirm).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(panel.discardChanges()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    confirm.mockRestore();
});
test("questions put tabs after the title, totals and paging inside the list card, and preparation last", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (method, params) => {
        const result = await original(method, params);
        return method === "memoryListQuestionSummaries" &&
            result &&
            typeof result === "object"
            ? { ...result, total: 70 }
            : result;
    });
    const { panel } = setup();
    await panel.show();
    const host = document.querySelector("main")!;
    const tabs = host.querySelector('[aria-label="Question filter"]')!;
    const card = host.querySelector('[aria-label="Questions list"]')!;
    expect(tabs.previousElementSibling!.classList).toContain("hub-qhead");
    expect(tabs.nextElementSibling).toBe(card);
    expect(card.classList).toContain("card");
    expect(card.querySelector(".hub-list-total")!.textContent).toBe("70 total");
    expect(card.querySelectorAll(".hub-qrow")).toHaveLength(1);
    expect(
        card.lastElementChild!.querySelector("nav")!.getAttribute("aria-label"),
    ).toBe("questions pages");
    expect(host.lastElementChild!.querySelector("summary")!.textContent).toBe(
        "Knowledge preparation",
    );
});
test("question filter tabs keep icons, exclusive selection and server filters", async () => {
    const { panel, onError } = setup();
    await panel.show();
    const filters = document.querySelector('[aria-label="Question filter"]')!;
    expect(filters.classList).toContain("hub-tabs");
    expect(filters.closest(".hub-qfilters")).toBeNull();
    expect(filters.querySelectorAll('i[aria-hidden="true"]')).toHaveLength(3);
    for (const answerFilter of ["open", "answered"]) {
        click(answerFilter === "open" ? "Open" : "Answered");
        await settle();
        expect(filters.querySelectorAll('[aria-pressed="true"]')).toHaveLength(
            1,
        );
        expect(invoke).toHaveBeenCalledWith(
            "memoryListQuestionSummaries",
            expect.objectContaining({ answerFilter }),
        );
    }
    expect(onError).not.toHaveBeenCalled();
});
test("a scope switch cannot reuse another collection's fresh cached question page", async () => {
    let scope = "corpus";
    const { panel } = setup(() => scope);
    await panel.show();
    expect(document.body.textContent).toContain("What is the name?");
    scope = "unavailable";
    await panel.show();
    expect(document.body.textContent).not.toContain("What is the name?");
    expect(
        invoke.mock.calls.filter(
            ([method]) => method === "memoryListQuestionSummaries",
        ),
    ).toHaveLength(1);
});
test("question selection immediately shows a loading inspector and late details cannot replace a newer selection", async () => {
    const first = question();
    const second = question();
    second.slot.id = "second";
    second.slot.question = "Where is the office?";
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(
        inventoryFixture((method, params) =>
            method === "memoryListQuestions"
                ? { head: "head", items: [first, second] }
                : original(method, params),
        ),
    );
    const { panel, onError } = setup();
    await panel.show();
    let resolveFirst!: (value: unknown) => void;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetQuestion"
            ? params.slotId === "slot"
                ? new Promise((resolve) => {
                      resolveFirst = resolve;
                  })
                : Promise.resolve(second)
            : original(method, params),
    );
    click(first.slot.question);
    const inspector = document.querySelector(
        '[aria-label="Question inspector"]',
    )!;
    expect(inspector.getAttribute("aria-busy")).toBe("true");
    expect(inspector.textContent).toContain("Loading question details...");
    expect(inspector.querySelector("textarea")).toBeNull();
    click(second.slot.question);
    await settle();
    expect(inspector.textContent).toContain(second.slot.question);
    resolveFirst(first);
    await settle();
    expect(inspector.textContent).toContain(second.slot.question);
    expect(inspector.getAttribute("aria-busy")).toBe("false");
    expect(onError).not.toHaveBeenCalled();
});
test("question failures are visible in the inspector and retry loads the actual details", async () => {
    const { panel, onError } = setup();
    await panel.show();
    const original = invoke.getMockImplementation()!;
    let failed = false;
    invoke.mockImplementation((method, params) => {
        if (method !== "memoryGetQuestion") return original(method, params);
        if (failed) return Promise.resolve(question());
        failed = true;
        return Promise.reject(new Error("Read unavailable"));
    });
    click("What is the name?");
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Read unavailable",
    );
    click("Retry question details");
    await settle();
    expect(
        document.querySelector('[aria-label="Question inspector"] textarea'),
    ).not.toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
});
test("leaving questions invalidates pending detail failures", async () => {
    const { panel, onError } = setup();
    await panel.show();
    let reject!: (error: Error) => void;
    invoke.mockImplementation(
        () =>
            new Promise((_, failure) => {
                reject = failure;
            }),
    );
    click("What is the name?");
    panel.hide();
    reject(new Error("Old request failed"));
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(
        document
            .querySelector('[aria-label="Question inspector"]')
            ?.getAttribute("aria-busy"),
    ).toBe("false");
});
test("complete inventory opens inspector and assertions serialize optimistic concurrency identity", async () => {
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
    await settle();
    const answer = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Question inspector"] textarea',
    )!;
    answer.value = '"Ada"';
    answer.dispatchEvent(new Event("input"));
    click("Save user assertion");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryEditQuestion", {
        corpusId: "corpus",
        viewId: "view",
        slotId: "slot",
        expectedHead: "head",
        expectedVersion: 2,
        edit: { kind: "assert", value: "Ada" },
    });
    expect(onError).not.toHaveBeenCalled();
});
test.each([false, true])(
    "source proposals retain evidence without fabricated human confirmation (policy admission: %s)",
    async (policyAdmission) => {
        const current = question();
        if (policyAdmission)
            current.slot.admission = {
                version: 1,
                actor: "policy",
                policyVersion: 1,
                recipeIdentity: "recipe",
                modelIdentity: "model",
                inputFingerprint: "source-scope",
                reason: "The source explicitly records a stable preference.",
            };
        current.slot.discoveryCitations = [
            {
                sourceId: "source",
                revisionId: "revision",
                locator: "chars:0-3",
                excerpt: "Ada",
            },
        ];
        invoke.mockImplementation(
            inventoryFixture(async (method: string) => {
                if (method === "memoryViewCapabilities")
                    return { derivedViews: { kinds: ["schemaView"] } };
                if (method === "memoryListQuestions")
                    return { head: "head", items: [current] };
                if (method === "memoryListAcquisitions") return [];
                throw new Error(`Unexpected ${method}`);
            }),
        );
        const { panel } = setup();
        await panel.show();
        click("What is the name?");
        await settle();
        expect(document.body.textContent).toContain("Source-proposed");
        expect(document.body.textContent).toContain("Answer review unreviewed");
        expect(
            document.querySelector('[aria-label="Knowledge preparation"]'),
        ).not.toBeNull();
        expect(
            invoke.mock.calls.some(
                ([method]) => method === "memoryGetKnowledgeStatus",
            ),
        ).toBe(false);
        if (policyAdmission) {
            expect(document.body.textContent).toContain("Policy-discovered");
            expect(document.body.textContent).toContain(
                "The source explicitly records a stable preference.",
            );
            expect(document.body.textContent).toContain(
                "Policy admission is not human confirmation",
            );
        }
        expect(
            document.querySelector(
                '[aria-label="source @ revision · chars:0-3"]',
            ),
        ).not.toBeNull();
    },
);
test("knowledge progress loads only when expanded and is not fetched for Inbox attention", async () => {
    const { panel } = setup();
    await panel.show();
    expect(
        invoke.mock.calls.some(
            ([method]) =>
                method === "memoryGetKnowledgeStatus" ||
                method === "memoryGetCorpus",
        ),
    ).toBe(false);
    const knowledgePanel = document
        .querySelector('[aria-label="Knowledge preparation"]')!
        .closest("details")!;
    knowledgePanel.open = true;
    knowledgePanel.dispatchEvent(new Event("toggle"));
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryGetKnowledgeStatus", {
        corpusId: "corpus",
    });
    const calls = invoke.mock.calls.length;
    await panel.refreshAttention();
    expect(
        invoke.mock.calls
            .slice(calls)
            .some(
                ([method]) =>
                    method === "memoryGetKnowledgeStatus" ||
                    method === "memoryGetCorpus",
            ),
    ).toBe(false);
});
test("invalid answers and unapproved authoring do not reach service edits", async () => {
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
    await settle();
    const answer = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Question inspector"] textarea',
    )!;
    answer.value = "42";
    answer.dispatchEvent(new Event("input"));
    click("Save user assertion");
    await settle();
    expect(onError).toHaveBeenCalled();
    expect(
        invoke.mock.calls.some(([method]) => method === "memoryEditQuestion"),
    ).toBe(false);
    click("Generate proposal");
    await settle();
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryProposeSchemaView",
        ),
    ).toBe(false);
});
test("unavailable capability and service errors are explicit, not empty success", async () => {
    const { panel } = setup();
    invoke.mockResolvedValueOnce({ derivedViews: { kinds: ["wiki"] } });
    await panel.show();
    expect(document.body.textContent).toContain("capability is unavailable");
    expect(
        invoke.mock.calls.some(([method]) => method === "memoryListQuestions"),
    ).toBe(false);
    invoke.mockImplementation(
        inventoryFixture(async () => {
            throw new Error("Offline");
        }),
    );
    await expect(panel.show()).rejects.toThrow("Offline");
});

test("an inventory failure clears stale decisions and reports an incomplete result", async () => {
    const { panel } = setup();
    await panel.show();
    expect(document.querySelector("aside")!.textContent).toContain(
        "Question decisions",
    );
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { kinds: ["schemaView"] } };
            throw new Error("Inventory unavailable");
        }),
    );

    await panel.refresh();
    expect(document.querySelector(".hub-list-total")!.textContent).toBe(
        "Unavailable",
    );
    expect(document.body.textContent).toContain(
        "Incomplete question inventory",
    );
    expect(document.querySelector("aside")!.textContent).not.toContain(
        "view · 1 decisions",
    );
});

test("question maintenance errors remain explicit alongside the complete inventory", async () => {
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { kinds: ["schemaView"] } };
            if (method === "memoryListQuestions")
                return {
                    head: "head",
                    items: [question()],
                    maintenanceError: "Source evaluation failed",
                };
            if (method === "memoryListAcquisitions") return [];
            throw new Error(`Unexpected ${method}`);
        }),
    );
    const { panel } = setup();
    await panel.show();
    expect(document.body.textContent).toContain(
        "Question maintenance failed: Source evaluation failed",
    );
    expect(document.querySelector(".hub-list-total")!.textContent).toBe(
        "1 total",
    );
});

test("candidate review retains exact source citations and never counts mentions as votes", async () => {
    const current = question();
    const citation = {
        sourceId: "source",
        revisionId: "old-revision",
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
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { kinds: ["schemaView"] } };
            if (method === "memoryListQuestions")
                return { head: "head", items: [current] };
            if (method === "memoryEditQuestion") return {};
            throw new Error(`Unexpected ${method}`);
        }),
    );
    viewInvoke.mockResolvedValue({
        available: true,
        title: "Original source",
        content: "Ada",
    });
    const { panel } = setup();
    await panel.show();
    click("What is the name?");
    await settle();
    expect(document.body.textContent).toContain("not independent votes");
    click("source @ old-revision · chars:0-3");
    await settle();
    expect(viewInvoke).toHaveBeenCalledWith("memoryHubSourceOriginal", {
        corpusId: "corpus",
        sourceId: "source",
        revisionId: "old-revision",
        locator: "chars:0-3",
    });
    click("Confirm candidate");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryEditQuestion", {
        corpusId: "corpus",
        viewId: "view",
        slotId: "slot",
        expectedHead: "head",
        expectedVersion: 2,
        edit: { kind: "review", candidateId: "candidate", review: "confirmed" },
    });
});

test("ordinary Markdown schema-page links remain navigable and scripts remain blocked", () => {
    const markdown = rbMarkdown(
        "[Address](memory-view://corpus/view?slotId=addresses&itemKey=home&revisionId=old)\n\n[Bad](javascript:alert(1))",
    );
    const link = markdown.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(
        "#/views/corpus/view/revision/old/page/addresses/item/home",
    );
    expect(link.target).toBe("");
    expect(markdown.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
});

test("bounded discovery configuration uses a validated service edit with optimistic version", async () => {
    const current = question();
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { kinds: ["schemaView"] } };
            if (method === "memoryListQuestions")
                return { head: "head", items: [current] };
            if (method === "memoryEditQuestion") return {};
            throw new Error(`Unexpected ${method}`);
        }),
    );
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
    await settle();
    const checkbox = document.querySelector<HTMLInputElement>(
        '[aria-label="Question inspector"] input[type="checkbox"]',
    )!;
    checkbox.checked = true;
    document.querySelector<HTMLInputElement>(
        'input[aria-label="Maximum question proposals"]',
    )!.value = "3";
    click("Save discovery configuration");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryEditQuestion", {
        corpusId: "corpus",
        viewId: "view",
        slotId: "slot",
        expectedHead: "head",
        expectedVersion: 2,
        edit: { kind: "discovery", enabled: true, maxProposals: 3 },
    });
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryDiscoverSchemaQuestions",
        ),
    ).toBe(false);
    expect(onError).not.toHaveBeenCalled();
});

test.each([0, 8])(
    "discovery accepts the finite lifetime bound %i without invoking discovery",
    async (maxProposals) => {
        const { panel, onError } = setup();
        await panel.show();
        click("What is the name?");
        await settle();
        document.querySelector<HTMLInputElement>(
            'input[aria-label="Maximum question proposals"]',
        )!.value = String(maxProposals);
        click("Save discovery configuration");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryEditQuestion",
            expect.objectContaining({
                edit: { kind: "discovery", enabled: false, maxProposals },
            }),
        );
        expect(onError).not.toHaveBeenCalled();
    },
);

test("discovery rejects an over-cap bound before sending any service edit", async () => {
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
    await settle();
    document.querySelector<HTMLInputElement>(
        'input[aria-label="Maximum question proposals"]',
    )!.value = "9";
    click("Save discovery configuration");
    await settle();
    expect(
        invoke.mock.calls.some(([method]) => method === "memoryEditQuestion"),
    ).toBe(false);
    expect(onError).toHaveBeenCalled();
});
