// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    resolveTypeReference,
    validateAction,
    type ActionSchemaTypeDefinition,
} from "@typeagent/action-schema";

/**
 * Build the object passed to validateAction for a TB gold action.
 * - Injects required single-literal string-union fields (e.g. settings `id`)
 * - Restores parameters:{} when the schema requires an empty parameters object
 *   after stripEmptyGoldPlaceholders dropped nested empties.
 */
export function translationBenchActionValidationPayload(
    definition: ActionSchemaTypeDefinition,
    action: {
        actionName: string;
        parameters?: Record<string, unknown>;
    },
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        actionName: action.actionName,
    };
    for (const [name, field] of Object.entries(definition.type.fields)) {
        if (name === "actionName" || name === "parameters") continue;
        if (field.optional) continue;
        const fieldType = resolveTypeReference(field.type);
        if (
            fieldType?.type === "string-union" &&
            fieldType.typeEnum.length === 1
        ) {
            payload[name] = fieldType.typeEnum[0];
        }
    }
    const parametersField = definition.type.fields.parameters;
    if (action.parameters !== undefined) {
        payload.parameters = action.parameters;
    } else if (parametersField !== undefined && !parametersField.optional) {
        payload.parameters = {};
    }
    return payload;
}

export function validateTranslationBenchGoldAction(
    definition: ActionSchemaTypeDefinition,
    action: {
        actionName: string;
        parameters?: Record<string, unknown>;
    },
): void {
    validateAction(
        definition,
        translationBenchActionValidationPayload(definition, action),
    );
}
