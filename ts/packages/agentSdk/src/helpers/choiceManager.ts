// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "../action.js";
import { randomUUID } from "node:crypto";

export type ChoiceResponse = boolean | number[];

/**
 * Manages choice callbacks agent-side.
 * Agents create an instance and pass it to action handlers.
 * The dispatcher calls handleChoice via regular RPC when the user responds.
 */
export class ChoiceManager {
    private callbacks = new Map<
        string,
        (response: ChoiceResponse) => Promise<ActionResult | undefined>
    >();

    registerChoice(
        onResponse: (
            response: ChoiceResponse,
        ) => Promise<ActionResult | undefined>,
    ): string {
        const id = randomUUID();
        this.callbacks.set(id, onResponse);
        return id;
    }

    async handleChoice(
        choiceId: string,
        response: ChoiceResponse,
    ): Promise<ActionResult | undefined> {
        const callback = this.callbacks.get(choiceId);
        if (!callback) {
            throw new Error("Choice not found or expired");
        }
        this.callbacks.delete(choiceId);
        return callback(response);
    }
}
