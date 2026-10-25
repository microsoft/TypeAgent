// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("../../src/extension/contentScript/webAgentStorage", () => ({
    webAgentStorage: {},
    crosswordSchemaStorage: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
    },
    registrationStorage: {
        markRegistered: jest.fn(),
        wasRecentlyRegistered: jest.fn(),
    },
}));
jest.mock("../../src/extension/webagent/webAgentRpc", () => ({
    extractCrosswordSchema: jest.fn(),
}));
jest.mock("../../src/extension/webagent/crossword/decisionBridge", () => ({
    getCrosswordMode: jest.fn(),
}));

import { CrosswordWebAgent } from "../../src/extension/webagent/crossword/CrosswordWebAgent";
import { getCrosswordMode } from "../../src/extension/webagent/crossword/decisionBridge";
import { extractCrosswordSchema } from "../../src/extension/webagent/webAgentRpc";
import {
    crosswordSchemaStorage,
    webAgentStorage,
} from "../../src/extension/contentScript/webAgentStorage";
import type { WebAgentContext } from "../../src/extension/webagent/WebAgentContext";

const url = "https://puzzle.example/same-page";
const context: WebAgentContext = {
    ui: {
        clickOn: jest.fn(),
        enterTextIn: jest.fn(),
        setDropdown: jest.fn(),
        scroll: jest.fn(),
    },
    extractComponent: jest.fn(),
    notify: jest.fn(),
    storage: webAgentStorage,
    getTabId: async () => null,
    getCurrentUrl: () => url,
    awaitPageReady: jest.fn(),
};

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    document.body.innerHTML =
        '<main><ol><li id="clue">1 Original clue</li></ol></main><aside>News</aside>';
    window.registerTypeAgent = jest.fn().mockResolvedValue(undefined);
    jest.mocked(getCrosswordMode).mockResolvedValue("generative");
    jest.mocked(crosswordSchemaStorage.get).mockReturnValue(null);
    jest.mocked(extractCrosswordSchema).mockImplementation(async () => ({
        boardId: "board",
        cells: {},
        clues: {
            across: {
                1: {
                    text: document.querySelector("#clue")!.textContent!,
                    selector: "#clue",
                },
            },
            down: {},
        },
        extractedAt: Date.now(),
    }));
});

afterEach(async () => {
    jest.mocked(getCrosswordMode).mockResolvedValue("decision");
    document.body.replaceChildren();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(500);
    jest.useRealTimers();
});

test("Generative sentinel ancestor replacement refreshes the same-URL schema after the existing debounce", async () => {
    await new CrosswordWebAgent().initialize(context);
    const original = document.querySelector("main")!;
    original.replaceWith(original.cloneNode(true));
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(499);
    expect(extractCrosswordSchema).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(extractCrosswordSchema).toHaveBeenCalledTimes(2);
    expect(crosswordSchemaStorage.remove).toHaveBeenCalledWith(url);
    expect(crosswordSchemaStorage.set).toHaveBeenCalledTimes(2);
});

test("Generative publisher updates, highlights and equivalent clue markup do not re-extract", async () => {
    await new CrosswordWebAgent().initialize(context);
    document.querySelector("aside")!.textContent = "Latest news";
    document.querySelector("#clue")!.className = "active";
    document.querySelector("#clue")!.innerHTML =
        "<span>1</span>  <strong>Original clue</strong>";
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(500);
    expect(extractCrosswordSchema).toHaveBeenCalledTimes(1);
    expect(crosswordSchemaStorage.remove).not.toHaveBeenCalled();
});

test("switching to Decision mode cancels the pending Generative sentinel refresh", async () => {
    await new CrosswordWebAgent().initialize(context);
    document.querySelector("#clue")!.textContent = "1 Replacement clue";
    await Promise.resolve();
    jest.mocked(getCrosswordMode).mockResolvedValue("decision");
    await jest.advanceTimersByTimeAsync(500);
    expect(extractCrosswordSchema).toHaveBeenCalledTimes(1);
    expect(crosswordSchemaStorage.remove).not.toHaveBeenCalled();
});
