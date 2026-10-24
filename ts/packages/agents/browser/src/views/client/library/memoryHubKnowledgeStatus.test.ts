// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubKnowledgeStatus } from "./memoryHubKnowledgeStatus";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock;
const checkpoint = {
    version: 1,
    checkpointId: "checkpoint",
    corpusId: "corpus",
    createdAt: "now",
    updatedAt: "now",
    state: "partial",
    sources: [{ sourceId: "source", revisionId: "revision" }],
    families: ["questions"],
    excludedFamilies: ["wiki"],
    producerComplete: false,
    indexVersion: "index",
    viewIds: [],
    jobIds: [],
    discoveryFingerprints: [],
    coverage: { inspectedSources: 1, deferredSources: 2 },
    reasons: ["Discovery budget exhausted"],
};
const knowledge = {
    discovery: {
        version: 1,
        policy: "off",
        policyVersion: 1,
        receipts: [],
        routes: [],
        callTimes: [],
    },
    checkpoints: [checkpoint],
};
function setup() {
    document.body.innerHTML = "<main></main>";
    return mountMemoryHubKnowledgeStatus(document.querySelector("main")!);
}
async function settle() {
    for (let index = 0; index < 40; index++) await Promise.resolve();
}
function click(label: string) {
    const button = [...document.querySelectorAll("button")].find(
        (value) =>
            value.textContent === label ||
            value.getAttribute("aria-label") === label,
    );
    if (!button) throw new Error(`Missing button ${label}`);
    button.click();
}
beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryGetCorpus")
            return {
                sourceCount: 1,
                revisionCount: 1,
                readyRevisionCount: 1,
                activeJobCount: 0,
                failedRevisionCount: 0,
            };
        if (method === "memoryGetKnowledgeStatus") return knowledge;
        if (method === "memoryUpdateKnowledgeDiscovery") return knowledge;
        if (method === "memoryCreateKnowledgeCheckpoint") return checkpoint;
        throw new Error(`Unexpected operation ${method}`);
    });
});
test("indexed sources never imply ready knowledge; partial coverage and exclusions remain visible", async () => {
    const panel = setup();
    await panel.refresh([{ corpusId: "corpus", name: "Corpus" }]);
    expect(document.body.textContent).toContain("1/1 revisions indexed");
    expect(document.body.textContent).toContain(
        "Checkpoint checkpoint · partial",
    );
    expect(document.body.textContent).toContain("2 deferred sources");
    expect(document.body.textContent).toContain("excluded: wiki");
    expect(document.body.textContent).toContain("Discovery budget exhausted");
    expect(document.body.textContent).toContain("Not ready");
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryUpdateKnowledgeDiscovery",
        ),
    ).toBe(false);
});
test("discovery policy is read from service and changed only by explicit action", async () => {
    const panel = setup();
    await panel.refresh([{ corpusId: "corpus", name: "Corpus" }]);
    const select = document.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("off");
    select.value = "sourceObserved";
    click("Save discovery policy · Corpus");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryUpdateKnowledgeDiscovery", {
        corpusId: "corpus",
        policy: "sourceObserved",
    });
    click("Capture knowledge checkpoint · Corpus");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryCreateKnowledgeCheckpoint", {
        corpusId: "corpus",
        producerComplete: false,
    });
});
test("knowledge failures are explicit and do not erase available source progress", async () => {
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryGetCorpus")
            return {
                sourceCount: 0,
                revisionCount: 0,
                readyRevisionCount: 0,
                activeJobCount: 0,
                failedRevisionCount: 0,
            };
        throw new Error("Knowledge store unavailable");
    });
    const panel = setup();
    await panel.refresh([{ corpusId: "corpus", name: "Corpus" }]);
    expect(document.body.textContent).toContain("0/0 revisions indexed");
    expect(document.body.textContent).toContain(
        "Add sources to discover useful questions",
    );
    expect(document.body.textContent).toContain(
        "Knowledge preparation unavailable: Knowledge store unavailable",
    );
    expect(document.querySelector("select")).toBeNull();
});
test("failed policy updates are visible instead of success-shaped empty progress", async () => {
    const panel = setup();
    await panel.refresh([{ corpusId: "corpus", name: "Corpus" }]);
    invoke.mockRejectedValueOnce(new Error("Policy write failed"));
    click("Save discovery policy · Corpus");
    await settle();
    expect(document.body.textContent).toContain(
        "Knowledge operation failed: Policy write failed",
    );
});
test("explicit retry retains the service policy and bounded wait never reports a nonready checkpoint as ready", async () => {
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryGetCorpus")
            return {
                sourceCount: 1,
                revisionCount: 1,
                readyRevisionCount: 1,
                activeJobCount: 0,
                failedRevisionCount: 0,
            };
        if (method === "memoryGetKnowledgeStatus")
            return {
                ...knowledge,
                discovery: {
                    ...knowledge.discovery,
                    error: "Discovery failed",
                },
                checkpoints: [{ ...checkpoint, state: "running" }],
            };
        if (method === "memoryUpdateKnowledgeDiscovery") return knowledge;
        if (method === "memoryWaitForKnowledgeCheckpoint") return checkpoint;
        throw new Error(`Unexpected ${method}`);
    });
    const panel = setup();
    await panel.refresh([{ corpusId: "corpus", name: "Corpus" }]);
    click("Retry failed discovery · Corpus");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryUpdateKnowledgeDiscovery", {
        corpusId: "corpus",
        policy: "off",
        retryFailed: true,
    });
    click("Wait up to 30 seconds");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryWaitForKnowledgeCheckpoint", {
        corpusId: "corpus",
        checkpointId: "checkpoint",
        timeoutMs: 30000,
    });
    expect(document.body.textContent).toContain(
        "Knowledge operation failed: Checkpoint partial: Discovery budget exhausted",
    );
});
