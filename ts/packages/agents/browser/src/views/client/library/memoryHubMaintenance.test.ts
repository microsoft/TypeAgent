// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewVersion,
    ViewMaintenancePlan,
} from "@typeagent/memory-service";
import { createMaintenancePanel } from "./memoryHubMaintenance";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const head = "a".repeat(40);
const view: ViewVersion = {
    corpusId: "c",
    viewId: "guide",
    revisionId: "r",
    version: 2,
    actor: "user",
    createdAt: "2026-10-09T00:00:00Z",
    state: "draft",
    provenance: "generated",
    definition: {
        viewId: "guide",
        revisionId: "d",
        kind: "troubleshootingGuide",
        selector: { kind: "sources", sources: [] },
    },
    content: {
        kind: "troubleshootingGuide",
        title: "Guide",
        citations: [],
        sections: [],
    },
    relationships: [],
};
const plan: ViewMaintenancePlan = {
    corpusId: "c",
    expectedHead: head,
    targets: [
        {
            viewId: "guide",
            expectedVersion: 2,
            state: "blocked",
            reason: "Pending ingestion",
        },
    ],
};

function click(host: HTMLElement, title: string): void {
    const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === title,
    );
    if (!button) throw new Error(`Missing maintenance button ${title}`);
    button.click();
}

test("friendly update scope fields produce the exact typed selector and keep JSON in a closed disclosure", async () => {
    invoke.mockReset();
    invoke.mockResolvedValue({ version: view });
    let pending: Promise<void> | undefined;
    const changed = jest.fn();
    const host = createMaintenancePanel(view, head, {
        action: (operation) => {
            pending = operation();
        },
        onChange: changed,
        dirty: () => false,
        saved: async () => {},
        onBuild: () => {},
        isCurrent: () => true,
    });
    const mode = host.querySelector<HTMLSelectElement>(
        '[aria-label="Sources for future updates"]',
    )!;
    mode.value = "scopedSources";
    mode.dispatchEvent(new Event("change"));
    for (const [label, value] of [
        ["Source types (comma separated)", "markdown, text"],
        ["All tags (comma separated)", "reviewed, reviewed, project"],
        ["Exact project metadata", "Payments"],
    ]) {
        const input = host.querySelector<HTMLInputElement>(
            `[aria-label="${label}"]`,
        )!;
        input.value = value;
        input.dispatchEvent(new Event("input"));
    }
    expect(host.querySelector("textarea")!.closest("details")!.open).toBe(
        false,
    );
    click(host, "Save maintenance definition");
    await pending;
    expect(invoke).toHaveBeenCalledWith(
        "memoryUpdateViewMaintenance",
        expect.objectContaining({
            expectedHead: head,
            expectedVersion: view.version,
            maintenance: {
                schemaVersion: 1,
                scope: {
                    mode: "scopedSources",
                    sourceTypes: ["markdown", "text"],
                    tags: ["reviewed", "project"],
                    project: "Payments",
                },
            },
        }),
    );
    expect(changed).toHaveBeenCalledTimes(4);
});

test("maintenance editor sends explicit guarded configuration, previews blockers and uses fresh plans", async () => {
    invoke.mockReset();
    const errors: unknown[] = [];
    let dirty = false;
    let pending: Promise<void> | undefined;
    const saved = jest.fn(async () => {
        dirty = false;
    });
    const onBuild = jest.fn();
    invoke.mockImplementation(async (method) => {
        if (method === "memoryUpdateViewMaintenance") return { version: view };
        if (method === "memoryPlanViewMaintenance") return plan;
        if (method === "memoryMaintainViews")
            return { receiptId: "receipt", plan };
        throw new Error(`Unexpected maintenance operation ${method}`);
    });
    const host = createMaintenancePanel(view, head, {
        action: (operation) => {
            pending = operation().catch((error) => {
                errors.push(error);
            });
        },
        onChange: () => {
            dirty = true;
        },
        dirty: () => dirty,
        saved,
        onBuild,
        isCurrent: () => true,
    });
    const editor = host.querySelector("textarea")!;
    editor.value = JSON.stringify({
        schemaVersion: 1,
        scope: { mode: "currentSources", sourceIds: ["source"] },
    });
    editor.dispatchEvent(new Event("input"));
    click(host, "Run manual maintenance");
    await pending;
    expect(errors).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
    click(host, "Save maintenance definition");
    await pending;
    expect(invoke).toHaveBeenCalledWith("memoryUpdateViewMaintenance", {
        corpusId: "c",
        viewId: "guide",
        expectedHead: head,
        expectedVersion: 2,
        maintenance: {
            schemaVersion: 1,
            scope: { mode: "currentSources", sourceIds: ["source"] },
        },
    });
    expect(saved).toHaveBeenCalledTimes(1);
    click(host, "Preview maintenance");
    for (const control of host.querySelectorAll("button")) {
        if (
            ["Preview maintenance", "Run manual maintenance"].includes(
                control.textContent ?? "",
            )
        )
            expect(control.querySelector("i")!.className).toBe(
                "fa-solid fa-screwdriver-wrench",
            );
    }
    await pending;
    expect(host.textContent).toContain("Pending ingestion");
    click(host, "Run manual maintenance");
    await pending;
    expect(invoke).toHaveBeenCalledWith("memoryMaintainViews", {
        corpusId: "c",
        expectedHead: head,
        targets: [{ viewId: "guide", expectedVersion: 2 }],
    });
    expect(host.textContent).toContain("receipt");
    expect(onBuild).not.toHaveBeenCalled();
});

test("unknown maintenance modes and failed writes preserve unsaved input and expose errors", async () => {
    invoke.mockReset();
    let pending: Promise<void> | undefined;
    const errors: unknown[] = [];
    const saved = jest.fn(async () => {});
    const host = createMaintenancePanel(view, head, {
        action: (operation) => {
            pending = operation().catch((error) => {
                errors.push(error);
            });
        },
        onChange: () => {},
        dirty: () => false,
        saved,
        onBuild: () => {},
        isCurrent: () => true,
    });

    const editor = host.querySelector("textarea")!;
    editor.value = '{"schemaVersion":1,"scope":{"mode":"unknown"}}';
    click(host, "Save maintenance definition");
    await pending;
    expect(errors).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
    editor.value = '{"schemaVersion":1,"scope":{"mode":"pinned"}}';
    invoke.mockRejectedValueOnce(new Error("Definition head conflict"));
    click(host, "Save maintenance definition");
    await pending;
    expect(errors).toHaveLength(2);
    expect(editor.value).toContain("pinned");
    expect(saved).not.toHaveBeenCalled();
});

test("late plans do not start maintenance after the panel or corpus changes", async () => {
    invoke.mockReset();
    let current = true;
    let pending: Promise<void> | undefined;
    let resolvePlan: ((value: ViewMaintenancePlan) => void) | undefined;
    invoke.mockImplementation(
        () =>
            new Promise((resolve) => {
                resolvePlan = resolve;
            }),
    );
    const onBuild = jest.fn();
    const host = createMaintenancePanel(view, head, {
        action: (operation) => {
            pending = operation();
        },
        onChange: () => {},
        dirty: () => false,
        saved: async () => {},
        onBuild,
        isCurrent: () => current,
    });
    click(host, "Run manual maintenance");
    current = false;
    resolvePlan!(plan);
    await pending;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onBuild).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Pending ingestion");
});
