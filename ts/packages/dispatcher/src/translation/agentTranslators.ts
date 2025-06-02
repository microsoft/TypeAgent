// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CachedImageWithDetails,
    createJsonTranslatorWithValidator,
    enableJsonTranslatorStreaming,
    JsonTranslatorOptions,
    TypeAgentJsonValidator,
} from "common-utils";
import { AppAction, SchemaTypeNames } from "@typeagent/agent-sdk";
import { Result } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import {
    getMultipleActionSchemaDef,
    MultipleActionOptions,
} from "./multipleActionSchema.js";
import {
    TranslatorSchemaDef,
    composeTranslatorSchemas,
    IncrementalJsonValueCallBack,
} from "common-utils";

import { HistoryContext, ParamObjectType } from "agent-cache";
import { createTypeAgentRequestPrompt } from "../context/chatHistoryPrompt.js";
import {
    composeActionSchema,
    ComposeSchemaOptions,
    composeSelectedActionSchema,
    createActionSchemaJsonValidator,
} from "./actionSchemaJsonTranslator.js";
import {
    ActionSchemaTypeDefinition,
    generateActionSchema,
    generateSchemaTypeDefinition,
    ActionSchemaObject,
    SchemaCreator as sc,
    GenerateSchemaOptions,
} from "action-schema";
import { ActionConfig } from "./actionConfig.js";
import { ActionConfigProvider } from "./actionConfigProvider.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { CompleteUsageStatsCallback } from "aiclient";

export function getAppAgentName(schemaName: string) {
    return schemaName.split(".")[0];
}

const additionalActionLookupTypeName = "AdditionalActionLookupAction";
const additionalActionLookup = "additionalActionLookup";
export type AdditionalActionLookupAction = {
    actionName: "additionalActionLookup";
    parameters: {
        schemaName: string;
        request: string; // this is constrained to active translators in the LLM schema
    };
};

export function isAdditionalActionLookupAction(
    action: AppAction,
): action is AdditionalActionLookupAction {
    return action.actionName === additionalActionLookup;
}

const additionalActionLookupTypeComments = [
    ` Use this ${additionalActionLookupTypeName} to look up additional actions in schema groups`,
    " The schema group will be chosen based on the schemaName parameter",
];
export function createChangeAssistantActionSchema(
    actionConfigs: ActionConfig[],
): ActionSchemaTypeDefinition {
    const schemaNameParameterComments = actionConfigs.map(
        (actionConfig) =>
            ` ${actionConfig.schemaName} - ${actionConfig.description}`,
    );
    const obj: ActionSchemaObject = sc.obj({
        actionName: sc.string(additionalActionLookup),
        parameters: sc.obj({
            schemaName: sc.field(
                sc.string(
                    actionConfigs.map(
                        (actionConfig) => actionConfig.schemaName,
                    ),
                ),
                schemaNameParameterComments,
            ),
            request: sc.field(
                sc.string(),
                "complete request that can be translated, do not use entities' id for this field",
            ),
        }),
    } as const);
    return sc.intf(
        additionalActionLookupTypeName,
        obj,
        additionalActionLookupTypeComments,
        true,
    );
}

function getChangeAssistantSchemaDef(
    switchActionConfigs: ActionConfig[],
): TranslatorSchemaDef | undefined {
    if (switchActionConfigs.length === 0) {
        return undefined;
    }
    const definition = createChangeAssistantActionSchema(switchActionConfigs);
    if (definition === undefined) {
        return undefined;
    }
    return {
        kind: "inline",
        typeName: additionalActionLookupTypeName,
        schema: generateSchemaTypeDefinition(definition, { exact: true }),
    };
}

export function getActionSchemaTypeName(schemaType: string | SchemaTypeNames) {
    return typeof schemaType === "string" ? schemaType : schemaType.action;
}

export function getActivitySchemaTypeName(
    schemaType: string | SchemaTypeNames,
) {
    return typeof schemaType === "string" ? undefined : schemaType.activity;
}

export function getEntitySchemaTypeName(schemaType: string | SchemaTypeNames) {
    return typeof schemaType === "string" ? undefined : schemaType.entities;
}

/**
 * Combine all action schema type names into a single type name
 * @param schemaType
 * @returns
 */
export function getCombinedActionSchemaTypeName(
    actionConfig: ActionConfig,
): string | undefined {
    const schemaType = actionConfig.schemaType;
    if (typeof schemaType === "string") {
        return schemaType;
    }
    if (schemaType.action !== undefined) {
        return schemaType.activity !== undefined
            ? `${schemaType.action}${schemaType.activity}`
            : schemaType.action;
    }
    if (schemaType.activity !== undefined) {
        return schemaType.activity;
    }
    throw new Error(
        `Action config ${actionConfig.schemaName} does not have any action or activity schema type`,
    );
}

function getTranslatorSchemaDef(
    actionConfig: ActionConfig,
): TranslatorSchemaDef {
    const actionTypeName = getActionSchemaTypeName(actionConfig.schemaType);
    const activityTypeName = getActivitySchemaTypeName(actionConfig.schemaType);

    // Cannot disable activity if we don't regenerate the schema
    let typeName: string;
    if (actionTypeName === undefined) {
        if (activityTypeName === undefined) {
            throw new Error(
                `Action config ${actionConfig.schemaName} does not have any action or activity schema type`,
            );
        }
        typeName = activityTypeName;
    } else {
        typeName = activityTypeName
            ? `${actionTypeName} | ${activityTypeName}`
            : actionTypeName;
    }

    if (typeof actionConfig.schemaFile === "string") {
        return {
            kind: "file",
            typeName,
            fileName: getPackageFilePath(actionConfig.schemaFile),
        };
    }

    if (actionConfig.schemaFile.format === "ts") {
        return {
            kind: "inline",
            typeName,
            schema: actionConfig.schemaFile.content,
        };
    }

    throw new Error(
        `Unsupported schema source type: ${actionConfig.schemaFile.format}"`,
    );
}

function getTranslatorSchemaDefs(
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    multipleActionOptions: MultipleActionOptions = false,
): TranslatorSchemaDef[] {
    // Cannot disable activity if we don't regenerate the schema
    const translationSchemaDefs = actionConfigs.map(getTranslatorSchemaDef);

    // subAction for multiple action
    const subActionType = actionConfigs.flatMap((s) => {
        const returnTypes: string[] = [];
        const actionType = getActionSchemaTypeName(s.schemaType);
        if (actionType) {
            returnTypes.push(actionType);
        }
        const activityType = getActivitySchemaTypeName(s.schemaType);
        if (activityType) {
            returnTypes.push(activityType);
        }
        return returnTypes;
    });

    // Add change assistant schema if needed
    const changeAssistantSchemaDef =
        getChangeAssistantSchemaDef(switchActionConfigs);

    if (changeAssistantSchemaDef) {
        translationSchemaDefs.push(changeAssistantSchemaDef);
        subActionType.push(changeAssistantSchemaDef.typeName);
    }

    // Add multiple action schema
    const multipleActionSchemaDef = multipleActionOptions
        ? getMultipleActionSchemaDef(subActionType, multipleActionOptions)
        : undefined;

    if (multipleActionSchemaDef) {
        translationSchemaDefs.push(multipleActionSchemaDef);
    }

    return translationSchemaDefs;
}

export type TypeAgentTranslator<T = TranslatedAction> = {
    translate(
        request: string,
        history?: HistoryContext,
        attachments?: CachedImageWithDetails[],
        cb?: IncrementalJsonValueCallBack,
        usageCallback?: CompleteUsageStatsCallback,
    ): Promise<Result<T>>;
    checkTranslate(request: string): Promise<Result<T>>;
    getSchemaName(actionName: string): string | undefined;
};

// TranslatedAction are actions returned from the LLM without the translator name
export interface TranslatedAction {
    actionName: string;
    parameters?: ParamObjectType;
}

function createTypeAgentValidator<T extends TranslatedAction>(
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    composeOptions?: ComposeSchemaOptions,
    generateOptions?: GenerateSchemaOptions | null, // null means not generated
) {
    return generateOptions !== null
        ? createActionSchemaJsonValidator<T>(
              composeActionSchema(
                  actionConfigs,
                  switchActionConfigs,
                  provider,
                  composeOptions,
              ),
              generateOptions,
          )
        : createTypeScriptJsonValidator<T>(
              composeTranslatorSchemas(
                  "AllActions",
                  getTranslatorSchemaDefs(
                      actionConfigs,
                      switchActionConfigs,
                      composeOptions?.multiple,
                  ),
              ),
              "AllActions",
          );
}

function collectSchemaName(
    actionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    definitions?: ActionSchemaTypeDefinition[],
    actionConfig?: ActionConfig,
) {
    const schemaNameMap = new Map<string, string>();
    for (const actionConfig of actionConfigs) {
        const schemaFile = provider.getActionSchemaFileForConfig(actionConfig);
        for (const actionName of schemaFile.parsedActionSchema.actionSchemas.keys()) {
            const existing = schemaNameMap.get(actionName);
            if (existing) {
                throw new Error(
                    `Conflicting action name '${actionName}' from schema '${schemaFile.schemaName}' and '${existing}'`,
                );
            }
            schemaNameMap.set(actionName, actionConfig.schemaName);
        }
    }
    if (definitions !== undefined && actionConfig !== undefined) {
        for (const definition of definitions) {
            const actionName =
                definition.type.fields.actionName.type.typeEnum[0];
            const existing = schemaNameMap.get(actionName);
            if (existing) {
                throw new Error(
                    `Conflicting action name '${actionName}' from schema '${actionConfig.schemaName}' and '${existing}'`,
                );
            }
            schemaNameMap.set(actionName, actionConfig.schemaName);
        }
    }
    return schemaNameMap;
}

/**
 *
 * @param schemaName name to get the translator for.
 * @param activeSchemas The set of active translators to include for injected and change assistant actions. Default to false if undefined.
 * @param multipleActions Add the multiple action schema if true. Default to false.
 * @returns
 */
export function loadAgentJsonTranslator<
    T extends TranslatedAction = TranslatedAction,
>(
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    options?: ComposeSchemaOptions,
    generateOptions?: GenerateSchemaOptions | null, // null means not generated
    model?: string,
): TypeAgentTranslator<T> {
    const validator = createTypeAgentValidator<T>(
        actionConfigs,
        switchActionConfigs,
        provider,
        options,
        generateOptions,
    );
    // Collect schema name mapping.
    const schemaNameMap = collectSchemaName(actionConfigs, provider);
    return createTypeAgentTranslator<T>(validator, schemaNameMap, { model });
}

function createTypeAgentTranslator<
    T extends TranslatedAction = TranslatedAction,
>(
    validator: TypeAgentJsonValidator<T>,
    schemaNameMap: Map<string, string>,
    options: JsonTranslatorOptions<T>,
): TypeAgentTranslator<T> {
    const translator = createJsonTranslatorWithValidator<T>(
        validator.getTypeName().toLowerCase(),
        validator,
        options,
    );
    const streamingTranslator = enableJsonTranslatorStreaming(translator);

    // the request prompt is already expanded by the override replacement below
    // So just return the request as is.
    streamingTranslator.createRequestPrompt = (request: string) => {
        return request;
    };

    // Create another translator so that we can have a different
    // debug/token count tag
    const altTranslator = createJsonTranslatorWithValidator(
        "check",
        validator,
        options,
    );
    altTranslator.createRequestPrompt = (request: string) => {
        return request;
    };
    const typeAgentTranslator = {
        translate: async (
            request: string,
            history?: HistoryContext,
            attachments?: CachedImageWithDetails[],
            cb?: IncrementalJsonValueCallBack,
            usageCallback?: CompleteUsageStatsCallback,
        ) => {
            // Expand the request prompt up front with the history and attachments
            const requestPrompt = createTypeAgentRequestPrompt(
                validator,
                request,
                history,
                attachments,
            );

            return streamingTranslator.translate(
                requestPrompt,
                history?.promptSections,
                attachments,
                cb,
                usageCallback,
            );
        },
        // No streaming, no history, no attachments.
        checkTranslate: async (request: string) => {
            const requestPrompt = createTypeAgentRequestPrompt(
                validator,
                request,
                undefined,
                undefined,
                false,
            );
            return altTranslator.translate(requestPrompt);
        },
        getSchemaName(actionName: string) {
            return schemaNameMap.get(actionName);
        },
    };

    return typeAgentTranslator;
}

export function createTypeAgentTranslatorForSelectedActions<
    T extends TranslatedAction = TranslatedAction,
>(
    definitions: ActionSchemaTypeDefinition[],
    actionConfig: ActionConfig,
    additionalActionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
    options?: ComposeSchemaOptions,
    model?: string,
) {
    const validator = createActionSchemaJsonValidator<T>(
        composeSelectedActionSchema(
            definitions,
            actionConfig,
            additionalActionConfigs,
            switchActionConfigs,
            provider,
            options,
        ),
    );
    const schemaNameMap = collectSchemaName(
        additionalActionConfigs,
        provider,
        definitions,
        actionConfig,
    );
    return createTypeAgentTranslator<T>(validator, schemaNameMap, { model });
}

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    schemaName: string,
    provider: ActionConfigProvider,
    activeSchemas: string[] = [],
    changeAgentAction: boolean,
    options?: ComposeSchemaOptions,
    generateOptions?: GenerateSchemaOptions | null, // null means not generated
): string {
    const actionConfigs: ActionConfig[] = [
        provider.getActionConfig(schemaName),
    ];
    const switchActionConfigs: ActionConfig[] = [];

    for (const actionConfig of provider.getActionConfigs()) {
        if (
            schemaName === actionConfig.schemaName ||
            !activeSchemas.includes(actionConfig.schemaName)
        ) {
            continue;
        }
        if (actionConfig.injected) {
            actionConfigs.push(actionConfig);
        } else if (changeAgentAction) {
            switchActionConfigs.push(actionConfig);
        }
    }

    if (generateOptions !== null) {
        return generateActionSchema(
            composeActionSchema(
                actionConfigs,
                switchActionConfigs,
                provider,
                options,
            ),
            generateOptions,
        );
    }
    const schemaDefs = getTranslatorSchemaDefs(
        actionConfigs,
        switchActionConfigs,
        options?.multiple,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
