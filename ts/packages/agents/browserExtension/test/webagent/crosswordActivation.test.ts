// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { WebAgent } from "../../src/extension/webagent/WebAgentContext";

jest.mock("../../src/extension/contentScript/webAgentStorage", () => ({
    webAgentStorage: {},
}));
jest.mock("../../src/extension/contentScript/elementInteraction", () => ({
    sendUIEventsRequest: jest.fn(),
}));
jest.mock("../../src/extension/webagent/webAgentRpc", () => ({
    extractComponent: jest.fn(),
    sendNotification: jest.fn(),
}));

function agent(name: string, urlPatterns: RegExp[]): WebAgent {
    return {
        name,
        urlPatterns,
        initialize: jest.fn().mockResolvedValue(undefined),
    };
}

describe("crossword DOM activation", () => {
    beforeEach(() => {
        jest.resetModules();
        document.body.replaceChildren();
    });

    test("unrelated pages do not activate the crossword agent", async () => {
        const loader = await import(
            "../../src/extension/webagent/webAgentLoader"
        );
        const crossword = agent("crossword", [/example\.invalid/]);
        crossword.matchesDocument = () => false;
        loader.registerWebAgent(crossword);
        expect(loader.getActiveWebAgent()).toBeNull();
        expect(crossword.initialize).not.toHaveBeenCalled();
    });

    test("a detected engine takes precedence over a generic URL agent", async () => {
        const loader = await import(
            "../../src/extension/webagent/webAgentLoader"
        );
        const generic = agent("webflow", [/.*/]);
        loader.registerWebAgent(generic);
        const crossword = agent("crossword", [/example\.invalid/]);
        crossword.matchesDocument = () => true;
        loader.registerWebAgent(crossword);
        expect(loader.getActiveWebAgent()).toBe(crossword);
        expect(crossword.initialize).toHaveBeenCalledTimes(1);
    });

    test("late engine detection initializes the same agent once", async () => {
        const loader = await import(
            "../../src/extension/webagent/webAgentLoader"
        );
        const crossword = agent("crossword", [/example\.invalid/]);
        crossword.matchesDocument = () =>
            document.querySelector(".xlv-frame .xlv-clue-text") !== null;
        loader.registerWebAgent(crossword);
        expect(crossword.initialize).not.toHaveBeenCalled();
        document.body.innerHTML =
            '<div class="xlv-frame"><span class="xlv-clue-text">A clue</span></div>';
        loader.registerWebAgent(crossword);
        loader.registerWebAgent(crossword);
        expect(loader.getActiveWebAgent()).toBe(crossword);
        expect(crossword.initialize).toHaveBeenCalledTimes(1);
    });
    test("on-demand crossword actions do not steal an unrelated site's agent", async () => {
        const loader = await import(
            "../../src/extension/webagent/webAgentLoader"
        );
        const generic = agent("webflow", [/.*/]);
        loader.registerWebAgent(generic);
        const crossword = agent("crossword", []);
        crossword.initializeOnDemand = jest.fn().mockResolvedValue(undefined);
        await loader.registerOnDemandWebAgent(crossword);
        expect(crossword.initializeOnDemand).toHaveBeenCalledTimes(1);
        expect(crossword.initialize).not.toHaveBeenCalled();
        expect(loader.getActiveWebAgent()).toBe(generic);
    });
});
