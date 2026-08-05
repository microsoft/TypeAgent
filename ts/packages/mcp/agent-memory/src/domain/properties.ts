// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invalidArgument, invariant } from "./errors.js";
import type { PropertyDefinitionId, ScopeId, TopicId, TurnId } from "./ids.js";
import {
    requireAbsoluteTimestamp,
    requireText,
    type Revision,
} from "./metadata.js";

export type TopicPropertyType =
    | "string"
    | "number"
    | "boolean"
    | "timestamp"
    | "string-list";

export type TopicPropertyDefinition = {
    definitionId: PropertyDefinitionId;
    scopeId: ScopeId;
    topicId: TopicId;
    name: string;
    valueType: TopicPropertyType;
    required: boolean;
    allowedValues?: readonly string[];
    revision: Revision;
};

export type TopicPropertyPrimitive = string | number | boolean;
export type TopicPropertyData = TopicPropertyPrimitive | readonly string[];

export type TopicPropertyValue = {
    definitionId: PropertyDefinitionId;
    topicId: TopicId;
    value: TopicPropertyData;
    definitionRevision: Revision;
    updatedByTurnId: TurnId;
    updatedAt: string;
};

export function createTopicPropertyDefinition(
    input: Omit<TopicPropertyDefinition, "revision">,
): TopicPropertyDefinition {
    const allowedValues = input.allowedValues?.map((value) =>
        requireText(value, "property.allowedValue"),
    );
    invariant(
        allowedValues === undefined || input.valueType === "string",
        "Only string properties may define allowed values",
        { definitionId: input.definitionId, valueType: input.valueType },
    );
    invariant(
        allowedValues === undefined ||
            new Set(allowedValues).size === allowedValues.length,
        "Property allowed values must be unique",
        { definitionId: input.definitionId },
    );

    return Object.freeze({
        ...input,
        name: requireText(input.name, "property.name"),
        ...(allowedValues === undefined
            ? {}
            : { allowedValues: Object.freeze(allowedValues) }),
        revision: 1,
    });
}

export function createTopicPropertyValue(
    definition: TopicPropertyDefinition,
    input: Omit<
        TopicPropertyValue,
        "definitionId" | "topicId" | "definitionRevision"
    >,
): TopicPropertyValue {
    validatePropertyValue(definition, input.value);

    return Object.freeze({
        ...input,
        definitionId: definition.definitionId,
        topicId: definition.topicId,
        definitionRevision: definition.revision,
        value: Array.isArray(input.value)
            ? Object.freeze([...input.value])
            : input.value,
        updatedAt: requireAbsoluteTimestamp(
            input.updatedAt,
            "propertyValue.updatedAt",
        ),
    });
}

function validatePropertyValue(
    definition: TopicPropertyDefinition,
    value: TopicPropertyData,
): void {
    const isValid =
        (definition.valueType === "string" && typeof value === "string") ||
        (definition.valueType === "number" &&
            typeof value === "number" &&
            Number.isFinite(value)) ||
        (definition.valueType === "boolean" && typeof value === "boolean") ||
        (definition.valueType === "timestamp" && typeof value === "string") ||
        (definition.valueType === "string-list" &&
            Array.isArray(value) &&
            value.every((item) => typeof item === "string"));

    if (!isValid) {
        return invalidArgument("Property value does not match its definition", {
            definitionId: definition.definitionId,
            valueType: definition.valueType,
        });
    }
    if (definition.valueType === "timestamp") {
        requireAbsoluteTimestamp(value as string, "property.value");
    }
    if (
        definition.allowedValues !== undefined &&
        !definition.allowedValues.includes(value as string)
    ) {
        return invalidArgument("Property value is not allowed", {
            definitionId: definition.definitionId,
            value,
        });
    }
}
