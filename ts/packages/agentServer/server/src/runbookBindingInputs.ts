// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentEditionInput } from "@typeagent/memory-service";
import { boundRunbookJson } from "./runbookBindingArguments.js";

export function createRunbookInputSchema(
    inputs: readonly AgentEditionInput[],
): Record<string, unknown> {
    boundRunbookJson(inputs);
    if (!Array.isArray(inputs))
        throw new Error("Declared inputs must be an array.");
    const ids = new Set<string>();
    for (const input of inputs) {
        if (
            input === null ||
            typeof input !== "object" ||
            typeof input.id !== "string" ||
            input.id.length === 0 ||
            !["string", "number", "boolean", "enum"].includes(input.type) ||
            typeof input.required !== "boolean" ||
            typeof input.secret !== "boolean"
        )
            throw new Error("Invalid declared runbook input metadata.");
        if (ids.has(input.id))
            throw new Error("Duplicate declared runbook input.");
        ids.add(input.id);
    }
    return {
        type: "object",
        properties: Object.fromEntries(
            inputs.map((input) => [
                input.id,
                {
                    type: input.type === "enum" ? "string" : input.type,
                    ...(input.enumValues === undefined
                        ? {}
                        : { enum: input.enumValues }),
                    ...(input.secret ? { writeOnly: true } : {}),
                },
            ]),
        ),
        required: inputs
            .filter((input) => input.required)
            .map((input) => input.id),
    };
}
