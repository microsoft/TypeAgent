// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("../../src/extension/contentScript/webAgentStorage", () => ({
    webAgentStorage: {},
    crosswordSchemaStorage: { get: jest.fn() },
    registrationStorage: { markRegistered: jest.fn() },
}));
jest.mock("../../src/extension/webagent/webAgentRpc", () => ({
    extractCrosswordSchema: jest.fn(),
}));
jest.mock("../../src/extension/webagent/crossword/decisionBridge", () => ({
    getCrosswordMode: jest.fn(),
    crosswordBridge: jest.fn(),
}));

import { CrosswordWebAgent } from "../../src/extension/webagent/crossword/CrosswordWebAgent";
import { getCrosswordMode } from "../../src/extension/webagent/crossword/decisionBridge";
import { extractCrosswordSchema } from "../../src/extension/webagent/webAgentRpc";
import { webAgentStorage } from "../../src/extension/contentScript/webAgentStorage";
import type { WebAgentContext } from "../../src/extension/webagent/WebAgentContext";

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
    getCurrentUrl: () => "https://unrecognized.example/article-with-iframe",
    awaitPageReady: jest.fn(),
};

beforeEach(() => {
    jest.clearAllMocks();
    window.registerTypeAgent = jest.fn().mockResolvedValue(undefined);
    jest.mocked(getCrosswordMode).mockResolvedValue("decision");
});

test("unknown pages publish only opt-in actions, without inference, extraction or loading UI", async () => {
    const agent = new CrosswordWebAgent();
    await agent.initializeOnDemand(context);
    await agent.initializeOnDemand(context);
    expect(window.registerTypeAgent).toHaveBeenCalledTimes(1);
    expect(extractCrosswordSchema).not.toHaveBeenCalled();
    expect(context.notify).not.toHaveBeenCalled();
    expect(context.awaitPageReady).not.toHaveBeenCalled();
});

test("Generative default does not publish crossword actions on unrelated pages", async () => {
    jest.mocked(getCrosswordMode).mockResolvedValue("generative");
    await new CrosswordWebAgent().initializeOnDemand(context);
    expect(window.registerTypeAgent).not.toHaveBeenCalled();
    expect(extractCrosswordSchema).not.toHaveBeenCalled();
});
