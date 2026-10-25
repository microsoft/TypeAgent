// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAllHandlers } from "../../src/extension/serviceWorker/serviceWorkerRpcHandlers";
import { forwardCrosswordDecisionRpc } from "../../src/extension/serviceWorker/crosswordDecisionRpc";

jest.mock("../../src/extension/serviceWorker/tabManager", () => ({}));
jest.mock("../../src/extension/serviceWorker/websocket", () => ({}));
jest.mock(
    "../../src/extension/serviceWorker/screenshotCoordinator",
    () => ({}),
);
jest.mock(
    "../../src/extension/serviceWorker/browserViewNavigation",
    () => ({}),
);
jest.mock("../../src/extension/serviceWorker/dispatcherConnection", () => ({}));
jest.mock("../../src/extension/serviceWorker/recording", () => ({}));
jest.mock("../../src/extension/serviceWorker/messageHandlers", () => ({}));
jest.mock("@typeagent/dispatcher-types", () => ({}));
jest.mock("../../src/extension/serviceWorker/crosswordDecisionRpc", () => ({
    forwardCrosswordDecisionRpc: jest.fn(),
}));

describe("Crossword settings RPC", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined);
        (chrome.storage.sync.set as jest.Mock).mockResolvedValue(undefined);
        (chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 7 }]);
        (chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined);
    });

    test("persists the validated preference and broadcasts no unrelated settings", async () => {
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
            crosswordMode: "decision",
        });
        const settings = {
            crosswordMode: "decision",
            agentServerHost: "ws://localhost:8999/",
        };
        await expect(
            createAllHandlers().settingsUpdated({ settings }),
        ).resolves.toEqual({ success: true });
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            knowledgeSettings: {
                ...settings,
                crosswordDecisionStrategy: "hybrid",
            },
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
            type: "crosswordModeChanged",
            mode: "decision",
            strategy: "hybrid",
        });
    });

    test("uses storage validation rather than trusting an incoming enum", async () => {
        (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
            crosswordMode: "invalid",
        });
        const warning = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        try {
            await createAllHandlers().settingsUpdated({
                settings: { crosswordMode: "invalid" },
            });
            expect(chrome.storage.sync.set).toHaveBeenCalledWith({
                crosswordMode: "generative",
            });
            expect(chrome.storage.local.set).toHaveBeenCalledWith({
                knowledgeSettings: {
                    crosswordMode: "generative",
                    crosswordDecisionStrategy: "hybrid",
                },
            });
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
                type: "crosswordModeChanged",
                mode: "generative",
                strategy: "hybrid",
            });
        } finally {
            warning.mockRestore();
        }
    });

    test("capability display forwards only the status RPC without clue inference", async () => {
        const capabilities = {
            available: false,
            provider: "azure",
            model: "test",
            configGeneration: "test",
        };
        (forwardCrosswordDecisionRpc as jest.Mock).mockResolvedValue(
            capabilities,
        );
        expect(
            await createAllHandlers().getCrosswordDecisionCapabilities(),
        ).toEqual(capabilities);
        expect(forwardCrosswordDecisionRpc).toHaveBeenCalledTimes(1);
        expect(forwardCrosswordDecisionRpc).toHaveBeenCalledWith(
            "getCrosswordDecisionCapabilities",
        );
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});
