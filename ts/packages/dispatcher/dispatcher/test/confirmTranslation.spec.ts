// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, jest } from "@jest/globals";
import type { ActionContext } from "@typeagent/agent-sdk";
import type { RequestAction } from "agent-cache";
import { confirmTranslation } from "../src/translation/confirmTranslation.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

// ---------------------------------------------------------------------------
// confirmTranslation gates the interactive Run/Cancel/Edit action
// confirmation (clientIO.proposeAction) on `confirmActions`, NOT on
// `developerMode`. This guards the normal (no `--confirm`) path: recording
// conversation data with `@config dev on` must NOT force a confirmation
// prompt, and batch mode must never prompt. Only `@config dev on --confirm`
// (which sets confirmActions) triggers the prompt.
// ---------------------------------------------------------------------------

type Overrides = {
    confirmActions?: boolean;
    batchMode?: boolean;
};

function makeContext(overrides: Overrides) {
    const proposeAction = jest.fn(async () => undefined);
    const agentContext = {
        confirmActions: overrides.confirmActions ?? false,
        batchMode: overrides.batchMode ?? false,
        currentRequestId: { requestId: "req-1" },
        agents: { getActiveSchemas: () => [] as string[] },
        clientIO: { proposeAction },
    };
    const context = {
        sessionContext: { agentContext },
    } as unknown as ActionContext<CommandHandlerContext>;
    return { context, proposeAction };
}

const requestAction = {
    request: "test",
    actions: [],
} as unknown as RequestAction;

describe("confirmTranslation gate", () => {
    it("does not confirm when confirmActions is off (normal @config dev on / no dev mode)", async () => {
        const { context, proposeAction } = makeContext({
            confirmActions: false,
        });
        const result = await confirmTranslation(
            0,
            "user",
            requestAction,
            context,
        );
        expect(result).toEqual({ requestAction });
        expect(proposeAction).not.toHaveBeenCalled();
    });

    it("does not confirm in batch mode even when confirmActions is on", async () => {
        const { context, proposeAction } = makeContext({
            confirmActions: true,
            batchMode: true,
        });
        const result = await confirmTranslation(
            0,
            "user",
            requestAction,
            context,
        );
        expect(result).toEqual({ requestAction });
        expect(proposeAction).not.toHaveBeenCalled();
    });

    it("confirms via clientIO.proposeAction when confirmActions is on (--confirm)", async () => {
        const { context, proposeAction } = makeContext({
            confirmActions: true,
            batchMode: false,
        });
        const result = await confirmTranslation(
            0,
            "user",
            requestAction,
            context,
        );
        // proposeAction returns undefined (no replacement) -> original kept.
        expect(result).toEqual({ requestAction });
        expect(proposeAction).toHaveBeenCalledTimes(1);
    });
});
