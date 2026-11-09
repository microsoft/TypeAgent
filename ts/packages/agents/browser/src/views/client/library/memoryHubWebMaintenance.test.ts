// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubWebMaintenance } from "./memoryHubWebMaintenance";
import { invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
const ready = {
    hasGraph: true,
    entityCount: 4,
    relationshipCount: 2,
    communityCount: 1,
    isBuilding: false,
};
async function settle() {
    for (let index = 0; index < 10; index++) await Promise.resolve();
}
function button(name: string): HTMLButtonElement {
    return Array.from(document.querySelectorAll("button")).find(
        (value) => value.textContent === name,
    )!;
}
beforeEach(() => {
    document.body.replaceChildren();
    invoke.mockReset().mockResolvedValue(ready);
});

test("maintenance stays browser-scoped and reads actual metrics before enabling mutations", async () => {
    const open = jest.fn();
    const panel = mountMemoryHubWebMaintenance(document.body, {
        onError: jest.fn(),
        onOpenGraph: open,
    });
    expect(button("Build browser graph").disabled).toBe(true);
    await panel.show();
    expect(invoke).toHaveBeenCalledWith("getKnowledgeGraphStatus", {});
    expect(document.body.textContent).toContain("4 entities");
    expect(document.body.textContent).toContain("not the selected corpus");
    button("Explore browser entity graph").click();
    expect(open).toHaveBeenCalledTimes(1);
    panel.dispose();
});

test("failed status and failed build never turn into successful zero metrics or completion notices", async () => {
    const errors = jest.fn();
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    const panel = mountMemoryHubWebMaintenance(document.body, {
        onError: errors,
        onOpenGraph: jest.fn(),
    });
    invoke.mockResolvedValueOnce({ ...ready, error: "Browser lens offline" });
    await panel.show();
    expect(document.body.textContent).toContain("Browser lens offline");
    expect(document.body.textContent).not.toContain("4 entities");
    expect(button("Build browser graph").disabled).toBe(true);
    await panel.show();
    invoke.mockResolvedValueOnce({
        success: false,
        error: "Graph index unavailable",
    });
    button("Rebuild browser graph").click();
    await settle();
    expect(document.body.textContent).toContain("Graph index unavailable");
    expect(invoke).toHaveBeenLastCalledWith("rebuildKnowledgeGraph", {});
    expect(errors).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("successfully");
    confirm.mockRestore();
    panel.dispose();
});

test("confirmation is required and disposal suppresses late responses", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const errors = jest.fn();
    const panel = mountMemoryHubWebMaintenance(document.body, {
        onError: errors,
        onOpenGraph: jest.fn(),
    });
    await panel.show();
    button("Build browser graph").click();
    expect(invoke).toHaveBeenCalledTimes(1);
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const loading = panel.show();
    panel.dispose();
    finish({ ...ready, error: "Late failure" });
    await loading;
    expect(errors).not.toHaveBeenCalled();
    expect(document.body.childElementCount).toBe(0);
    confirm.mockRestore();
});
