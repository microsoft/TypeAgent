// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubPreferences } from "./memoryHubPreferences";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock;
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}
const saved = {
    revision: 7,
    enabled: true,
    detectCandidates: true,
    preferences: {
        instructions: "Keep original wording",
        custom: "Preserve",
        runbook: { buildAgentEdition: true, futurePreference: "Preserve too" },
    },
};
function setup() {
    const host = document.createElement("div");
    document.body.append(host);
    let scope: string | undefined = "a";
    const options = {
        scope: () => scope,
        onError: jest.fn(),
        onChanged: jest.fn(),
    };
    const panel = mountMemoryHubPreferences(host, options);
    return {
        host,
        options,
        panel,
        setScope(value: string | undefined) {
            scope = value;
        },
    };
}
beforeEach(() => {
    document.body.replaceChildren();
    invoke.mockReset();
    invoke.mockImplementation(async (method) =>
        method === "memoryGetHowToSettings" ? saved : { ...saved, revision: 8 },
    );
    window.confirm = jest.fn(() => true);
});
test("preference saves use exact settings revision and retain guidance and unknown keys", async () => {
    const { panel, host, options } = setup();
    await panel.show();
    host.querySelector<HTMLInputElement>('[name="describeImages"]')!.checked =
        true;
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryUpdateHowToSettings", {
        corpusId: "a",
        expectedRevision: 7,
        preferences: {
            instructions: "Keep original wording",
            custom: "Preserve",
            runbook: {
                buildAgentEdition: true,
                describeImages: true,
                mcpTools: false,
                approvedAutomations: false,
                futurePreference: "Preserve too",
            },
        },
    });
    expect(options.onChanged).toHaveBeenCalledTimes(1);
    panel.dispose();
});
test("All-memory preferences cannot mutate the last inspected corpus", async () => {
    const { panel, host, setScope, options } = setup();
    await panel.show();
    setScope(undefined);
    panel.scopeChanged();
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    await settle();
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryUpdateHowToSettings",
        ),
    ).toBe(false);
    expect(options.onError).toHaveBeenCalledWith(expect.any(Error));
    panel.dispose();
});
test("conflicts retain choices, block unsaved navigation and do not show success", async () => {
    const { panel, host, options } = setup();
    await panel.show();
    invoke.mockRejectedValue(new Error("Settings revision conflict"));
    const control = host.querySelector<HTMLInputElement>('[name="mcpTools"]')!;
    control.checked = true;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    await settle();
    expect(control.checked).toBe(true);
    expect(host.textContent).toContain("Your selections are retained");
    expect(options.onChanged).not.toHaveBeenCalled();
    window.confirm = jest.fn(() => false);
    expect(panel.discardChanges()).toBe(false);
    expect(control.checked).toBe(true);
    panel.dispose();
});
test("late settings responses cannot enable another corpus or a disposed form", async () => {
    const { panel, host, setScope } = setup();
    let resolve: ((value: typeof saved) => void) | undefined;
    invoke.mockImplementation(
        () =>
            new Promise<typeof saved>((done) => {
                resolve = done;
            }),
    );
    const pending = panel.show();
    setScope("b");
    panel.scopeChanged();
    resolve!(saved);
    await pending;
    expect(
        host.querySelector<HTMLButtonElement>('button[type="submit"]')!
            .disabled,
    ).toBe(true);
    panel.dispose();
});
