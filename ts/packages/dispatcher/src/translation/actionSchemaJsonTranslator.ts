// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success } from "typechat";
import {
    generateActionSchema,
    validateAction,
    ActionSchemaCreator as sc,
    ActionSchemaEntryTypeDefinition,
    ActionSchemaTypeDefinition,
    ActionSchemaUnion,
    ActionSchemaGroup,
    GenerateSchemaOptions,
    generateActionJsonSchema,
    generateActionActionFunctionJsonSchemas,
    ActionObjectJsonSchema,
    ActionFunctionJsonSchema,
} from "action-schema";
import {
    createJsonTranslatorWithValidator,
    JsonTranslatorOptions,
    TypeAgentJsonValidator,
} from "common-utils";
import {
    createChangeAssistantActionSchema,
    getCombinedActionSchemaTypeName,
    TranslatedAction,
} from "./agentTranslators.js";
import {
    createMultipleActionSchema,
    MultipleActionOptions,
} from "./multipleActionSchema.js";
import { ActionConfig } from "./actionConfig.js";
import {
    ActionConfigProvider,
    ActionSchemaFile,
} from "./actionConfigProvider.js";

function convertJsonSchemaOutput(
    jsonObject: unknown,
    jsonSchema: ActionObjectJsonSchema | ActionFunctionJsonSchema[],
) {
    if (Array.isArray(jsonSchema)) {
        const result = jsonObject as any;
        return {
            actionName: result.name,
            parameters: result.arguments,
        };
    }
    return (jsonObject as any).response;
}

export function createActionSchemaJsonValidator<T extends TranslatedAction>(
    actionSchemaGroup: ActionSchemaGroup,
    generateOptions?: GenerateSchemaOptions,
): TypeAgentJsonValidator<T> {
    const schema = generateActionSchema(actionSchemaGroup, generateOptions);
    const generateJsonSchema = generateOptions?.jsonSchema ?? false;
    const jsonSchemaFunction = generateOptions?.jsonSchemaFunction ?? false;
    const jsonSchema = jsonSchemaFunction
        ? generateActionActionFunctionJsonSchemas(actionSchemaGroup)
        : generateJsonSchema
          ? generateActionJsonSchema(actionSchemaGroup)
          : undefined;
    const schemaValidate =
        jsonSchema === undefined ||
        (generateOptions?.jsonSchemaValidate ?? false);
    return {
        getSchemaText: () => schema,
        getTypeName: () => actionSchemaGroup.entry.name,
        getJsonSchema: () => jsonSchema,
        validate(jsonObject: unknown): Result<T> {
            try {
                // Fix up the output when we are using jsonSchema.
                const value: any =
                    jsonSchema !== undefined
                        ? convertJsonSchemaOutput(jsonObject, jsonSchema)
                        : jsonObject;

                if (value.actionName === undefined) {
                    return error("Missing actionName property");
                }
                const actionSchema = actionSchemaGroup.actionSchemas.get(
                    value.actionName,
                );
                if (actionSchema === undefined) {
                    return error(`Unknown action name: ${value.actionName}`);
                }

                if (schemaValidate) {
                    validateAction(actionSchema, value);
                }
                // Return the unwrapped value with generateJsonSchema as the translated result
                return success(value);
            } catch (e: any) {
                return error(e.message);
            }
        },
    };
}

export function createJsonTranslatorFromActionSchema<
    T extends TranslatedAction,
>(
    typeName: string,
    actionSchemaGroup: ActionSchemaGroup,
    options?: JsonTranslatorOptions<T>,
    generateOptions?: GenerateSchemaOptions,
) {
    const validator = createActionSchemaJsonValidator<T>(
        actionSchemaGroup,
        generateOptions,
    );

    return createJsonTranslatorWithValidator(
        typeName.toLowerCase(),
        validator,
        options,
    );
}

class ActionSchemaBuilder {
    private readonly files: ActionSchemaFile[] = [];
    private readonly definitions: ActionSchemaEntryTypeDefinition[] = [];

    constructor(
        private readonly provider: ActionConfigProvider,
        private readonly activity: boolean = true,
    ) {}
    addActionConfig(...configs: ActionConfig[]) {
        for (const config of configs) {
            const actionSchemaFile =
                this.provider.getActionSchemaFileForConfig(config);
            this.files.push(actionSchemaFile);
            const entry = actionSchemaFile.parsedActionSchema.entry;
            if (entry.action) {
                this.definitions.push(entry.action);
            }
            if (this.activity && entry.activity) {
                this.definitions.push(entry.activity);
            }
        }
    }

    addTypeDefinition(definition: ActionSchemaEntryTypeDefinition) {
        this.definitions.push(definition);
    }

    getTypeUnion(): ActionSchemaUnion {
        return sc.union(
            this.definitions.map((definition) => sc.ref(definition)),
        );
    }

    build(typeName: string = "AllActions"): ActionSchemaGroup {
        const entry = sc.type(typeName, this.getTypeUnion(), undefined, true);
        const order = new Map<string, number>();
        for (const file of this.files) {
            if (file.parsedActionSchema.order) {
                const base = order.size;
                for (const [name, num] of file.parsedActionSchema.order) {
                    if (order.has(name)) {
                        throw new Error(
                            `Schema Builder Error: duplicate type definition '${name}'`,
                        );
                    }
                    order.set(name, base + num);
                }
            }
        }

        const actionSchemas = new Map<string, ActionSchemaTypeDefinition>();
        const pending = [...this.definitions];
        while (pending.length > 0) {
            const current = pending.shift()!;
            const currentType = current.type;
            switch (currentType.type) {
                case "type-union":
                    for (const t of currentType.types) {
                        if (t.definition === undefined) {
                            throw new Error(
                                `Schema Builder Error: unresolved type reference '${t.name}' in entry type union`,
                            );
                        }
                        pending.push(t.definition);
                    }
                    break;
                case "type-reference":
                    if (currentType.definition === undefined) {
                        throw new Error(
                            `Schema Builder Error: unresolved type reference '${currentType.name}' in entry type union`,
                        );
                    }
                    pending.push(currentType.definition);
                    break;
                case "object":
                    const actionName =
                        currentType.fields.actionName.type.typeEnum[0];
                    if (actionSchemas.get(actionName)) {
                        throw new Error(
                            `Schema Builder Error: duplicate action name '${actionName}'`,
                        );
                    }
                    actionSchemas.set(
                        actionName,
                        current as ActionSchemaTypeDefinition,
                    );
                    break;
                default:
                    // Should not reach here.
                    throw new Error("Invalid type");
            }
        }

        return { entry, actionSchemas, entitySchemas: undefined, order };
    }
}

export type ComposeSchemaOptions = {
    activity?: boolean; // default true
    multiple?: MultipleActionOptions; // default false
};
export function composeActionSchema(
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    options?: ComposeSchemaOptions,
) {
    const builder = new ActionSchemaBuilder(provider, options?.activity);
    builder.addActionConfig(...actionConfigs);
    return finalizeActionSchemaBuilder(
        builder,
        switchActionConfigs,
        options?.multiple,
    );
}

export function composeSelectedActionSchema(
    definitions: ActionSchemaTypeDefinition[],
    actionConfig: ActionConfig,
    additionalActionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    options?: ComposeSchemaOptions,
) {
    const builder = new ActionSchemaBuilder(provider, options?.activity);
    const union = sc.union(definitions.map((definition) => sc.ref(definition)));
    const typeName = `Partial${getCombinedActionSchemaTypeName(actionConfig)}`;
    const comments = `${typeName} is a partial list of actions available in schema group '${actionConfig.schemaName}'.`;

    const entry = sc.type(typeName, union, comments);
    builder.addTypeDefinition(entry);
    builder.addActionConfig(...additionalActionConfigs);
    return finalizeActionSchemaBuilder(
        builder,
        switchActionConfigs,
        options?.multiple,
    );
}

function finalizeActionSchemaBuilder(
    builder: ActionSchemaBuilder,
    switchActionConfigs: ActionConfig[],
    multipleActionOptions: MultipleActionOptions = false,
) {
    if (switchActionConfigs.length > 0) {
        builder.addTypeDefinition(
            createChangeAssistantActionSchema(switchActionConfigs),
        );
    }

    if (
        multipleActionOptions === true ||
        (multipleActionOptions !== false &&
            multipleActionOptions.enabled === true)
    ) {
        builder.addTypeDefinition(
            createMultipleActionSchema(
                builder.getTypeUnion(),
                multipleActionOptions,
            ),
        );
    }
    return builder.build();
}
