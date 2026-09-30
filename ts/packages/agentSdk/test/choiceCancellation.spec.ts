// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext } from "../src/agentInterface.js";
import { ChoiceManager } from "../src/helpers/choiceManager.js";

describe("ChoiceManager cancellation", () => {
    it("removes a callback without invoking it with a fabricated default", async () => {
        const choices = new ChoiceManager();
        let invoked = 0;
        const callback = async () => {
            invoked++;
            return undefined;
        };
        const id = choices.registerChoice(callback);
        expect(choices.cancelChoice(id)).toBe(true);
        expect(choices.cancelChoice(id)).toBe(false);
        await expect(
            choices.handleChoice(id, true, {} as ActionContext<unknown>),
        ).rejects.toThrow("Choice not found or expired");
        expect(invoked).toBe(0);
    });
});
