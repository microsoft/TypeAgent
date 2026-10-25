// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DEFAULT_EXTENSION_SETTINGS,
    getCrosswordMode,
    getCrosswordDecisionStrategy,
    notifyCrosswordModeChanged,
} from "../../src/extension/serviceWorker/storage";

describe("Crossword settings", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (chrome.storage.sync.set as jest.Mock).mockResolvedValue(undefined);
    });

    test("legacy settings default to Generative without changing extraction mode", async () => {
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});
        expect(await getCrosswordMode()).toBe("generative");
        expect(DEFAULT_EXTENSION_SETTINGS.crosswordMode).toBe("generative");
        expect(DEFAULT_EXTENSION_SETTINGS.defaultExtractionMode).toBe(
            "content",
        );
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    test.each(["generative", "decision"])(
        "reads saved %s preference",
        async (mode) => {
            (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
                crosswordMode: mode,
            });
            expect(await getCrosswordMode()).toBe(mode);
            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        },
    );

    test.each(["Decision", "", null, false, 1, {}])(
        "warns and persistently resets an invalid mode %#",
        async (crosswordMode) => {
            const warning = jest
                .spyOn(console, "warn")
                .mockImplementation(() => {});
            try {
                (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
                    crosswordMode,
                });
                expect(await getCrosswordMode()).toBe("generative");
                expect(chrome.storage.sync.set).toHaveBeenCalledWith({
                    crosswordMode: "generative",
                });
                expect(warning).toHaveBeenCalledWith(
                    "Invalid crossword mode; resetting to Generative.",
                );
            } finally {
                warning.mockRestore();
            }
        },
    );

    test("notifies every eligible tab and its frames with mode and strategy", async () => {
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
            crosswordDecisionStrategy: "hybrid2",
        });
        (chrome.tabs.query as jest.Mock).mockResolvedValue([
            { id: 1 },
            { id: 2 },
            { id: 3 },
            {},
        ]);
        (chrome.tabs.sendMessage as jest.Mock)
            .mockResolvedValue(undefined)
            .mockRejectedValueOnce(new Error("No receiver"));

        await expect(
            notifyCrosswordModeChanged("decision"),
        ).resolves.toBeUndefined();
        expect(chrome.tabs.query).toHaveBeenCalledWith({
            url: ["http://*/*", "https://*/*"],
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
        for (const id of [1, 2, 3]) {
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(id, {
                type: "crosswordModeChanged",
                mode: "decision",
                strategy: "hybrid2",
            });
        }
    });

    test("strategy defaults to baseline Hybrid and validates persisted Hybrid2", async () => {
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});
        expect(await getCrosswordDecisionStrategy()).toBe("hybrid");
        expect(DEFAULT_EXTENSION_SETTINGS.crosswordDecisionStrategy).toBe(
            "hybrid",
        );
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
            crosswordDecisionStrategy: "hybrid2",
        });
        expect(await getCrosswordDecisionStrategy()).toBe("hybrid2");
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    test("invalid strategy warns and persistently resets to Hybrid", async () => {
        const warning = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        try {
            (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
                crosswordDecisionStrategy: "invalid",
            });
            expect(await getCrosswordDecisionStrategy()).toBe("hybrid");
            expect(chrome.storage.sync.set).toHaveBeenCalledWith({
                crosswordDecisionStrategy: "hybrid",
            });
            expect(warning).toHaveBeenCalled();
        } finally {
            warning.mockRestore();
        }
    });
});
