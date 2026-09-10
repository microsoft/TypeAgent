// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    generateSchemaTypeDefinition,
    getActionDescription,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";
import type {
    ActionSchemaTypeDefinition,
    SchemaType,
} from "@typeagent/action-schema";
import {
    structuredActionProtocolVersion,
    type ActionAvailability,
    type ActionContract,
    type ActionExecutionPolicy,
    type ActionIdentity,
} from "@typeagent/dispatcher-types";
import type { ActionConfig } from "../translation/actionConfig.js";

function executionType(type: SchemaType): unknown {
    switch (type.type) {
        case "object":
            return {
                type: type.type,
                fields: Object.fromEntries(
                    Object.entries(type.fields).map(([name, field]) => [
                        name,
                        {
                            optional: field.optional === true,
                            type: executionType(field.type),
                        },
                    ]),
                ),
            };
        case "array":
            return {
                type: type.type,
                elementType: executionType(type.elementType),
            };
        case "type-union":
            return { type: type.type, types: type.types.map(executionType) };
        case "string-union":
            return { type: type.type, typeEnum: type.typeEnum };
        case "type-reference":
            return { type: type.type, name: type.name };
        default:
            return { type: type.type };
    }
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, item]) => item !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, item]) => [key, canonicalize(item)]),
        );
    }
    return value;
}

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
    availability: ActionAvailability,
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
    // Reuse the serializer's dependency closure, including recursive references.
    const serialized = toJSONParsedActionSchema({
        entry: { action: definition },
        actionSchemas: new Map([[identity.actionName, definition]]),
    });
    const executionContract = {
        protocolVersion: structuredActionProtocolVersion,
        identity,
        entry: serialized.entry,
        types: Object.fromEntries(
            Object.entries(serialized.types).map(([name, def]) => [
                name,
                executionType(def.type),
            ]),
        ),
        paramSpecs: definition.paramSpecs,
        policy,
        output,
        interactions,
        errorReasoning: config.errorReasoning,
        streaming:
            config.streamingActions?.includes(identity.actionName) ?? false,
    };
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(canonicalize(executionContract)))
        .digest("hex");
    return {
        ...identity,
        description: getActionDescription(definition) ?? "",
        availability,
        fingerprint,
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
