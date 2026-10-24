// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
function setup() {
    document.body.innerHTML = "<main></main><aside></aside>";
    const onError = jest.fn();
    return {
        onError,
        panel: mountMemoryHubQuestions(
            document.querySelector("main")!,
            document.querySelector("aside")!,
            {
                scope: () => "corpus",
                corpora: () => [{ corpusId: "corpus", name: "Corpus" }],
                hidden: {},
                persistHidden: jest.fn(),
                onError,
                onOpenSource: jest.fn(),
            },
        ),
    };
}
beforeEach(() => {
    invoke.mockReset();
    viewInvoke.mockReset();
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        if (method === "memoryListQuestions")
            return { head: "head", items: [question()] };
        if (method === "memoryEditQuestion") return {};
        throw new Error(`Unexpected operation ${method}`);
    });
});
test("complete inventory opens inspector and assertions serialize optimistic concurrency identity", async () => {
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
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
test("policy-discovered questions retain source-backed reason without fabricated human confirmation", async () => {
    const current = question();
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
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        if (method === "memoryListQuestions")
            return { head: "head", items: [current] };
        if (method === "memoryListAcquisitions") return [];
        throw new Error(`Unexpected ${method}`);
    });
    const { panel } = setup();
    await panel.show();
    click("What is the name?");
    expect(document.body.textContent).toContain("Policy-discovered");
    expect(document.body.textContent).toContain("Answer review: unreviewed");
    expect(document.body.textContent).toContain(
        "The source explicitly records a stable preference.",
    );
    expect(document.body.textContent).toContain(
        "Policy admission is not human confirmation",
    );
    expect(
        document.querySelector('[aria-label="source @ revision · chars:0-3"]'),
    ).not.toBeNull();
});
test("invalid answers and unapproved authoring do not reach service edits", async () => {
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
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
    invoke.mockImplementation(async () => {
        throw new Error("Offline");
    });
    await expect(panel.show()).rejects.toThrow("Offline");
});

test("an inventory failure clears stale decisions and reports an incomplete result", async () => {
    const { panel } = setup();
    await panel.show();
    expect(document.querySelector("aside")!.textContent).toContain(
        "Question decisions",
    );
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        throw new Error("Inventory unavailable");
    });

    await panel.refresh();
    expect(document.body.textContent).toContain(
        "Incomplete question inventory",
    );
    expect(document.querySelector("aside")!.textContent).not.toContain(
        "view · 1 decisions",
    );
});

test("question maintenance errors remain explicit alongside the complete inventory", async () => {
    invoke.mockImplementation(async (method: string) => {
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
    });
    const { panel } = setup();
    await panel.show();
    expect(document.body.textContent).toContain(
        "Question maintenance failed: Source evaluation failed",
    );
    expect(document.body.textContent).toContain("1 question");
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
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        if (method === "memoryListQuestions")
            return { head: "head", items: [current] };
        if (method === "memoryEditQuestion") return {};
        throw new Error(`Unexpected ${method}`);
    });
    viewInvoke.mockResolvedValue({
        available: true,
        title: "Original source",
        content: "Ada",
    });
    const { panel } = setup();
    await panel.show();
    click("What is the name?");
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
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["schemaView"] } };
        if (method === "memoryListQuestions")
            return { head: "head", items: [current] };
        if (method === "memoryEditQuestion") return {};
        throw new Error(`Unexpected ${method}`);
    });
    const { panel, onError } = setup();
    await panel.show();
    click("What is the name?");
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
