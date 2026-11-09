// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateSchemaTypeDefinition,
    getActionDescription,
} from "@typeagent/action-schema";
import type { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import {
    type ActionContract,
    type ActionExecutionPolicy,
    type ActionIdentity,
} from "@typeagent/dispatcher-types";
import type { ActionConfig } from "../translation/actionConfig.js";

function getPolicy(
    config: ActionConfig,
    actionName: string,
): ActionExecutionPolicy {
    if (
        config.actionPolicies !== undefined &&
        (config.actionPolicies === null ||
            typeof config.actionPolicies !== "object" ||
            Array.isArray(config.actionPolicies))
    ) {
        throw new Error(
            `Invalid structured action policies for '${config.schemaName}'`,
        );
    }
    const declaration = Object.prototype.hasOwnProperty.call(
        config.actionPolicies ?? {},
        actionName,
    )
        ? config.actionPolicies?.[actionName]
        : undefined;
    if (
        declaration !== undefined &&
        (declaration === null ||
            typeof declaration !== "object" ||
            Array.isArray(declaration))
    ) {
        throw new Error(
            `Invalid structured action policy for '${config.schemaName}.${actionName}'`,
        );
    }
    const effects =
        declaration?.effects === undefined ? "unknown" : declaration.effects;
    if (
        (effects !== "unknown" &&
            effects !== "read-only" &&
            effects !== "state-changing") ||
        (declaration?.confirmation !== undefined &&
            declaration.confirmation !== "required")
    ) {
        throw new Error(
            `Invalid structured action policy for '${config.schemaName}.${actionName}'`,
        );
    }
    return {
        effects,
        confirmation:
            effects === "read-only" && declaration?.confirmation !== "required"
                ? "not-required"
                : "required",
    };
}

export function createActionContract(
    identity: ActionIdentity,
    definition: ActionSchemaTypeDefinition,
    config: ActionConfig,
): ActionContract {
    const policy = getPolicy(config, identity.actionName);
    const output: ActionContract["output"] = {
        envelope: "ActionResult",
        optional: true,
        resultValue: { type: "unknown", optional: true },
        resultEntity: { type: "Entity", optional: true },
        entities: { type: "Entity[]", optional: true },
    };
    const interactions: ActionContract["interactions"] = {
        mode: "may-require-interaction",
        kinds: ["question", "choice", "form", "action-proposal"],
    };
    return {
        ...identity,
        description: getActionDescription(definition) ?? "",
        input: {
            format: "typescript",
            typeName: definition.name,
            schemaText: generateSchemaTypeDefinition(definition),
        },
        policy,
        output,
        interactions,
    };
}
