// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "../action.js";
import { ActionContext } from "../agentInterface.js";
import { QuestionFormResponse } from "../action.js";
import { randomUUID } from "node:crypto";

export type PickRememberResponse = { selected: number; remember: boolean };

export type ChoiceResponse =
    | boolean
    | number[]
    | PickRememberResponse
    | QuestionFormResponse;

// Callback registered with createYesNoChoiceResult / createMultiChoiceResult.
// `actionContext` is the LIVE ActionContext the dispatcher creates when
// responding to the choice — it's safe to call actionContext.actionIO.* on it
// from inside the callback. The original ActionContext that was passed when
// the choice was registered is stale by the time the callback runs (the
// dispatcher's RPC client has already closed its actionContextId).
export type ChoiceCallback = (
    response: ChoiceResponse,
    actionContext: ActionContext<unknown>,
) => Promise<ActionResult | undefined>;

/**
 * Manages choice callbacks agent-side.
 * Agents create an instance and pass it to action handlers.
 * The dispatcher calls handleChoice via regular RPC when the user responds.
 */
export class ChoiceManager {
    private callbacks = new Map<string, ChoiceCallback>();

    registerChoice(onResponse: ChoiceCallback): string {
        const id = randomUUID();
        this.callbacks.set(id, onResponse);
        return id;
    }

    async handleChoice(
        choiceId: string,
        response: ChoiceResponse,
        actionContext: ActionContext<unknown>,
    ): Promise<ActionResult | undefined> {
        const callback = this.callbacks.get(choiceId);
        if (!callback) {
            throw new Error("Choice not found or expired");
        }
        this.callbacks.delete(choiceId);
        return callback(response, actionContext);
    }
}
