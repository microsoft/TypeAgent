// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getProviderConfig } from "../src/utils/config.js";

describe("provider configurations", () => {
    it("loads the inbox profile with the expected bundled agents", () => {
        const config = getProviderConfig("inbox");

        expect(Object.keys(config.agents)).toEqual([
            "chat",
            "list",
            "timer",
            "player",
            "powershell",
            "utility",
            "taskflow",
            "browser",
            "code",
            "visualStudio",
            "github-cli",
            "calendar",
            "email",
            "greeting",
        ]);
        expect(config.agents.chat.execMode).toBe("dispatcher");
        expect(config.agents.taskflow.execMode).toBe("dispatcher");
        expect(config.agents.greeting.execMode).toBe("dispatcher");
        expect(config.explainers.v5.constructions?.data).toEqual([
            "./data/explainer/v5/data/player/basic.json",
        ]);
    });
});
