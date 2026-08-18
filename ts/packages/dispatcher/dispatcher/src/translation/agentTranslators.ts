// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CachedImageWithDetails,
    createJsonTranslatorWithValidator,
    enableJsonTranslatorStreaming,
    JsonTranslatorOptions,
    TypeAgentJsonValidator,
    IncrementalJsonValueCallBack,
} from "@typeagent/typechat-utils";
import { AppAction, SchemaTypeNames } from "@typeagent/agent-sdk";
import { Result } from "typechat";
import { HistoryContext, ParamObjectType } from "@typeagent/agent-cache";
import {
    createTypeAgentRequestPrompt,
    EntityPromptShape,
} from "../context/chatHistoryPrompt.js";
import {
    composeActionSchema,
    ComposeSchemaOptions,
    composeSelectedActionSchema,
    createActionSchemaJsonValidator,
} from "./actionSchemaJsonTranslator.js";
import {
    ActionSchemaTypeDefinition,
    generateActionSchema,
    ActionSchemaObject,
    SchemaCreator as sc,
    GenerateSchemaOptions,
} from "@typeagent/action-schema";
import { ActionConfig } from "./actionConfig.js";
import { ActionConfigProvider } from "./actionConfigProvider.js";
import {
    CompleteUsageStatsCallback,
    withChatModelTelemetryContext,
} from "@typeagent/aiclient";
import { PromptLogger } from "@typeagent/telemetry";
import type { UserContext } from "./userContext.js";

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

export type TypeAgentTranslator<T = TranslatedAction> = {
    translate(
        request: string,
        history?: HistoryContext,
        attachments?: CachedImageWithDetails[],
        cb?: IncrementalJsonValueCallBack,
        usageCallback?: CompleteUsageStatsCallback,
        signal?: AbortSignal,
        userContext?: UserContext,
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
    generateOptions?: GenerateSchemaOptions,
) {
    return createActionSchemaJsonValidator<T>(
        composeActionSchema(
            actionConfigs,
            switchActionConfigs,
            provider,
            composeOptions,
        ),
        generateOptions,
        buildInjectedSchemaNameMap(actionConfigs, provider),
    );
}

// Build a fallback map: actionName → schemaName for injected sub-schemas that
// are not already captured in the primary actionConfigs.  The LLM sees these
// actions in its prompt (because they are injected) but they may not be in the
// primary validation schema group, causing spurious "Unknown action name" errors.
function buildInjectedSchemaNameMap(
    actionConfigs: ActionConfig[],
    provider: ActionConfigProvider,
): Map<string, string> {
    const primarySchemaNames = new Set(actionConfigs.map((c) => c.schemaName));
    const map = new Map<string, string>();
    for (const config of provider.getActionConfigs()) {
        if (!config.injected || primarySchemaNames.has(config.schemaName)) {
            continue;
        }
        const schemaFile = provider.getActionSchemaFileForConfig(config);
        for (const actionName of schemaFile.parsedActionSchema.actionSchemas.keys()) {
            map.set(actionName, config.schemaName);
        }
    }
    return map;
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
    generateOptions?: GenerateSchemaOptions,
    model?: string,
    promptLogger?: PromptLogger,
    entityPromptShape: EntityPromptShape = "facets",
    entityPathNavigationEnabled: boolean = false,
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
    return createTypeAgentTranslator<T>(
        validator,
        schemaNameMap,
        {
            model,
            promptLogger,
        },
        entityPromptShape,
        entityPathNavigationEnabled,
    );
}

function createTypeAgentTranslator<
    T extends TranslatedAction = TranslatedAction,
>(
    validator: TypeAgentJsonValidator<T>,
    schemaNameMap: Map<string, string>,
    options: JsonTranslatorOptions<T>,
    entityPromptShape: EntityPromptShape = "facets",
    entityPathNavigationEnabled: boolean = false,
): TypeAgentTranslator<T> {
    const translator = createJsonTranslatorWithValidator<T>(
        validator.getTypeName().toLowerCase(),
        validator,
        options,
    );
    const streamingTranslator = enableJsonTranslatorStreaming(
        translator,
        options.promptLogger,
    );

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
            signal?: AbortSignal,
            userContext?: UserContext,
        ) => {
            // Expand the request prompt up front with the history and attachments
            const requestPrompt = createTypeAgentRequestPrompt(
                validator,
                request,
                history,
                attachments,
                true,
                entityPromptShape,
                entityPathNavigationEnabled,
                userContext,
            );

            return withChatModelTelemetryContext(
                { purpose: "action-generation" },
                () =>
                    streamingTranslator.translate(
                        requestPrompt,
                        history?.promptSections,
                        attachments,
                        cb,
                        usageCallback,
                        signal,
                    ),
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
                entityPromptShape,
                entityPathNavigationEnabled,
            );
            return withChatModelTelemetryContext(
                { purpose: "action-validation" },
                () => altTranslator.translate(requestPrompt),
            );
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
    promptLogger?: PromptLogger,
    entityPromptShape: EntityPromptShape = "facets",
    entityPathNavigationEnabled: boolean = false,
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
    return createTypeAgentTranslator<T>(
        validator,
        schemaNameMap,
        {
            model,
            promptLogger,
        },
        entityPromptShape,
        entityPathNavigationEnabled,
    );
}

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    schemaName: string,
    provider: ActionConfigProvider,
    activeSchemas: string[] = [],
    changeAgentAction: boolean,
    options?: ComposeSchemaOptions,
    generateOptions?: GenerateSchemaOptions,
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
