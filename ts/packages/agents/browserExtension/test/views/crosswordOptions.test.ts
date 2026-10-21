// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createChromeRpcClient } from "../../src/extension/views/chromeRpcClient";
import { DEFAULT_EXTENSION_SETTINGS } from "../../src/extension/serviceWorker/storage";
import type { EnhancedOptionsPage } from "../../src/extension/views/options";

jest.mock("../../src/extension/views/chromeRpcClient", () => ({
    createChromeRpcClient: jest.fn(),
}));

const html = readFileSync(
    resolve(__dirname, "../../src/extension/views/options.html"),
    "utf8",
);

describe("Crossword options lifecycle", () => {
    let OptionsPage: typeof EnhancedOptionsPage;
    let page: EnhancedOptionsPage;
    let stored: Record<string, unknown>;
    const invoke = jest.fn();

    beforeAll(() => {
        const listener = jest
            .spyOn(document, "addEventListener")
            .mockImplementation(() => {});
        OptionsPage =
            require("../../src/extension/views/options").EnhancedOptionsPage;
        listener.mockRestore();
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        document.documentElement.innerHTML = html;
        stored = {};
        (chrome.storage.sync.get as jest.Mock).mockImplementation(
            async (defaults: Record<string, unknown>) => ({
                ...defaults,
                ...stored,
            }),
        );
        (chrome.storage.sync.set as jest.Mock).mockImplementation(
            async (settings: Record<string, unknown>) =>
                Object.assign(stored, settings),
        );
        invoke.mockImplementation(async (method: string) =>
            method === "getCrosswordDecisionCapabilities"
                ? { available: false, configGeneration: "test" }
                : method === "checkAIModelAvailability"
                  ? { available: true }
                  : { success: true },
        );
        (createChromeRpcClient as jest.Mock).mockReturnValue({
            rpc: { invoke },
        });
        page = new OptionsPage();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function modeControl() {
        return document.querySelector<HTMLInputElement>(
            'input[name="crosswordMode"]:checked',
        )!;
    }

    async function settle() {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    async function save() {
        document
            .getElementById("optionsForm")!
            .dispatchEvent(new Event("submit", { cancelable: true }));
        await settle();
    }

    test("migrates legacy options to Generative and only checks capabilities on open", async () => {
        await page.initialize();
        expect(modeControl().value).toBe("generative");
        expect(invoke.mock.calls.map(([method]) => method)).toEqual(
            expect.arrayContaining([
                "checkAIModelAvailability",
                "getCrosswordDecisionCapabilities",
            ]),
        );
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    test("keeps unavailable Decision selected despite generic AI availability and saves it", async () => {
        stored.crosswordMode = "decision";
        await page.initialize();
        expect(modeControl().value).toBe("decision");
        expect(document.getElementById("aiStatus")!.textContent).toContain(
            "AI model available",
        );
        expect(
            document.getElementById("crosswordDecisionStatus")!.textContent,
        ).toContain("will not fall back");
        await save();
        expect(stored.crosswordMode).toBe("decision");
        expect(stored.defaultExtractionMode).toBe("content");
        expect(invoke).toHaveBeenCalledWith("settingsUpdated", {
            settings: expect.objectContaining({ crosswordMode: "decision" }),
        });
    });

    test("changing the radio choice updates status without inference or saving until submit", async () => {
        await page.initialize();
        const choice = document.getElementById(
            "crosswordModeDecision",
        ) as HTMLInputElement;
        choice.checked = true;
        choice.dispatchEvent(new Event("change", { bubbles: true }));
        expect(
            document.getElementById("crosswordDecisionStatus")!.textContent,
        ).toContain("Decision remains selected");
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        await save();
        expect(stored.crosswordMode).toBe("decision");
    });

    test("shows safe provider/model metadata independently of generic availability", async () => {
        invoke.mockImplementation(async (method: string) =>
            method === "getCrosswordDecisionCapabilities"
                ? {
                      available: true,
                      provider: "azure",
                      model: "<model>",
                      configGeneration: "test",
                      endpoint: "secret-endpoint",
                  }
                : { available: false },
        );
        await page.initialize();
        const status = document.getElementById("crosswordDecisionStatus")!;
        expect(status.textContent).toContain("Provider: azure");
        expect(status.textContent).toContain("Model: <model>");
        expect(status.innerHTML).toContain("&lt;model&gt;");
        expect(document.body.textContent).not.toContain("secret-endpoint");
    });

    test("capability lookup failure does not change the Decision preference", async () => {
        stored.crosswordMode = "decision";
        invoke.mockImplementation(async (method: string) => {
            if (method === "getCrosswordDecisionCapabilities") {
                throw new Error("Disconnected");
            }
            return { available: true };
        });
        jest.spyOn(console, "warn").mockImplementation(() => {});
        await page.initialize();
        expect(modeControl().value).toBe("decision");
        expect(
            document.getElementById("crosswordDecisionStatus")!.textContent,
        ).toContain("Crossword Decision unavailable");
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    test("resets an invalid stored enum with a visible warning and live notification", async () => {
        stored.crosswordMode = "invalid";
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        await page.initialize();
        expect(modeControl().value).toBe("generative");
        expect(stored.crosswordMode).toBe("generative");
        expect(document.getElementById("statusMessage")!.textContent).toContain(
            "Invalid Crossword Mode",
        );
        expect(document.getElementById("statusMessage")!.className).toContain(
            "warning",
        );
        expect(warn).toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith("settingsUpdated", {
            settings: expect.objectContaining({ crosswordMode: "generative" }),
        });
    });

    test("rejects an invalid form enum without saving", async () => {
        await page.initialize();
        modeControl().value = "invalid";
        await save();
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(document.getElementById("statusMessage")!.textContent).toContain(
            "valid Crossword Mode",
        );
    });

    test("reset restores Generative and notifies the service worker", async () => {
        stored.crosswordMode = "decision";
        await page.initialize();
        jest.spyOn(window, "confirm").mockReturnValue(true);
        document.getElementById("resetToDefaults")!.click();
        await settle();
        expect(modeControl().value).toBe("generative");
        expect(stored).toEqual(DEFAULT_EXTENSION_SETTINGS);
        expect(invoke).toHaveBeenCalledWith("settingsUpdated", {
            settings: expect.objectContaining({ crosswordMode: "generative" }),
        });
    });

    test("export contains the saved validated mode and no capability configuration", async () => {
        stored.crosswordMode = "decision";
        await page.initialize();
        const create = jest.fn((_blob: Blob) => "blob:settings");
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: create,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: jest.fn(),
        });
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
            () => {},
        );
        document.getElementById("exportSettings")!.click();
        const blob = create.mock.calls[0][0] as Blob;
        jest.useRealTimers();
        const exported = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsText(blob);
        });
        expect(JSON.parse(exported)).toEqual(
            expect.objectContaining({
                crosswordMode: "decision",
                defaultExtractionMode: "content",
            }),
        );
        expect(exported).not.toContain("configGeneration");
        expect(exported).not.toContain("endpoint");
    });

    test("export rejects an invalid settings enum with a visible warning", async () => {
        await page.initialize();
        (
            page as unknown as { settings: Record<string, unknown> }
        ).settings.crosswordMode = "invalid";
        document.getElementById("exportSettings")!.click();
        expect(document.getElementById("statusMessage")!.textContent).toContain(
            "Invalid Crossword Mode",
        );
        expect(document.getElementById("statusMessage")!.className).toContain(
            "warning",
        );
    });
});
