// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewSeparationProposal,
    ViewVersion,
} from "@typeagent/memory-service";
import { createSeparationPanel } from "./memoryHubSeparation";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const view = {
    corpusId: "corpus",
    viewId: "overview",
    revisionId: "accepted",
    version: 2,
} as ViewVersion;
const proposal: ViewSeparationProposal = {
    receiptId: "split-proposal",
    corpusId: "corpus",
    viewId: "overview",
    acceptedRevisionId: "accepted",
    acceptedVersion: 2,
    contentHash: "a".repeat(64),
    definitionHash: "b".repeat(64),
    assessmentHash: "c".repeat(64),
    confirmationToken: "d".repeat(64),
    reason: "Separate scoped purposes",
    overview: {
        title: "Complete original overview",
        retainedSectionIds: ["old-anchor"],
        retainedHumanUnits: ["section:old-anchor:body"],
    },
    destinations: ["Acquisition", "Publication"].map((purpose, index) => ({
        viewId: `child-${index}`,
        purpose,
        sectionIds: ["old-anchor"],
        citations: [
            {
                sourceId: "source",
                revisionId: "original",
                locator: "indexed:0",
                excerpt: "Original evidence",
            },
        ],
    })),
    unresolved: ["Human qualification remains in overview"],
    state: "proposed",
    reasonForState: "Awaiting explicit confirmation",
    createdAt: "2026-11-15T00:00:00Z",
};
function copyProposal(): ViewSeparationProposal {
    return JSON.parse(JSON.stringify(proposal));
}
async function settle() {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}
async function open() {
    const panel = createSeparationPanel(view);
    document.body.replaceChildren(panel);
    const disclosure = panel as HTMLDetailsElement;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
    await settle();
    return panel;
}
beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
        head: "e".repeat(40),
        proposal: copyProposal(),
    });
});
afterEach(() => document.body.replaceChildren());

test("destinations and retained human anchors are shown without ever confirming automatically", async () => {
    const panel = await open();
    expect(panel.textContent).toContain("Acquisition");
    expect(panel.textContent).toContain("Publication");
    expect(panel.textContent).toContain("old-anchor");
    expect(panel.textContent).toContain("section:old-anchor:body");
    expect(panel.textContent).toContain(
        "Human qualification remains in overview",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    const confirm = [...panel.querySelectorAll("button")].find(
        (button) => button.textContent === "Confirm this separation",
    )!;
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(invoke).toHaveBeenCalledTimes(1);
    const checkbox = panel.querySelector("input")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    confirm.click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memorySeparateView", {
        operation: "confirm",
        corpusId: "corpus",
        receiptId: "split-proposal",
        expectedHead: "e".repeat(40),
        confirmationToken: proposal.confirmationToken,
    });
});

test("partial accepted destinations never become navigation; active destinations link exact revisions", async () => {
    const incomplete = copyProposal();
    incomplete.state = "incomplete";
    incomplete.destinations[0].acceptedRevisionId = "child-revision-0";
    invoke.mockResolvedValue({ head: null, proposal: incomplete });
    let panel = await open();
    expect(panel.querySelectorAll("a")).toHaveLength(0);
    expect(panel.textContent).toContain("navigation withheld");
    const active = copyProposal();
    active.state = "active";
    active.destinations[0].acceptedRevisionId = "child-revision-0";
    active.destinations[1].acceptedRevisionId = "child-revision-1";
    invoke.mockResolvedValue({ head: null, proposal: active });
    panel = await open();
    expect(
        [...panel.querySelectorAll("a")].map((link) =>
            link.getAttribute("href"),
        ),
    ).toEqual([
        "#/views/corpus/child-0/revision/child-revision-0",
        "#/views/corpus/child-1/revision/child-revision-1",
    ]);
});
