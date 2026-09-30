// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, resolveTarget } from "@typeagent/aiclient";
import { Session } from "../src/context/session.js";

describe("session translation model", () => {
    test("defaults to GPT_5_6_LUNA and resolves to Luna in Copilot mode", async () => {
        const session = await Session.create();
        const model = session.getConfig().translation.model;
        expect(model).toBe(openai.GPT_5_6_LUNA);
        expect(resolveTarget("copilot", model)).toBe("gpt-5.6-luna");
    });

    test("preserves an explicit model and restores Luna on reset", async () => {
        const session = await Session.create({
            translation: { model: "GPT_4_O" },
        });
        expect(session.getConfig().translation.model).toBe("GPT_4_O");
        expect(resolveTarget("copilot", "GPT_4_O")).toBe("gpt-5.6-sol");

        session.updateSettings({ translation: { model: null } });
        expect(session.getConfig().translation.model).toBe(openai.GPT_5_6_LUNA);
    });
});
