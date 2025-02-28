// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CachedImageWithDetails,
    createJsonTranslatorFromSchemaDef,
    createJsonTranslatorWithValidator,
    enableJsonTranslatorStreaming,
    JsonTranslatorOptions,
} from "common-utils";
import { AppAction } from "@typeagent/agent-sdk";
import { Result, TypeChatJsonTranslator } from "typechat";
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
    composeSelectedActionSchema,
    createJsonTranslatorFromActionSchema,
} from "./actionSchemaJsonTranslator.js";
import {
    ActionSchemaTypeDefinition,
    generateActionSchema,
    generateSchemaTypeDefinition,
    ActionSchemaObject,
    ActionSchemaCreator as sc,
    GenerateSchemaOptions,
} from "action-schema";
import { ActionConfig } from "./actionConfig.js";
import { ActionConfigProvider } from "./actionConfigProvider.js";

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
            request: sc.string(),
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

function getTranslatorSchemaDef(
    actionConfig: ActionConfig,
): TranslatorSchemaDef {
    if (typeof actionConfig.schemaFile === "string") {
        return {
            kind: "file",
            typeName: actionConfig.schemaType,
            fileName: getPackageFilePath(actionConfig.schemaFile),
        };
    }

    if (actionConfig.schemaFile.type === "ts") {
        return {
            kind: "inline",
            typeName: actionConfig.schemaType,
            schema: actionConfig.schemaFile.content,
        };
    }

    throw new Error(
        `Unsupported schema source type: ${actionConfig.schemaFile.type}"`,
    );
}

function getTranslatorSchemaDefs(
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    multipleActionOptions: MultipleActionOptions,
): TranslatorSchemaDef[] {
    const translationSchemaDefs = actionConfigs.map(getTranslatorSchemaDef);

    // subAction for multiple action
    const subActionType = actionConfigs.map((s) => s.schemaType);

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

export type TypeAgentTranslator<T = object> = {
    translate: (
        request: string,
        history?: HistoryContext,
        attachments?: CachedImageWithDetails[],
        cb?: IncrementalJsonValueCallBack,
    ) => Promise<Result<T>>;
    checkTranslate: (request: string) => Promise<Result<T>>;
};

// TranslatedAction are actions returned from the LLM without the translator name
export interface TranslatedAction {
    actionName: string;
    parameters?: ParamObjectType;
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
    multipleActionOptions: MultipleActionOptions,
    generated: boolean = true,
    model?: string,
    generateOptions?: GenerateSchemaOptions,
): TypeAgentTranslator<T> {
    const options = { model };
    const translator = generated
        ? createJsonTranslatorFromActionSchema<T>(
              "AllActions",
              composeActionSchema(
                  actionConfigs,
                  switchActionConfigs,
                  provider,
                  multipleActionOptions,
              ),
              options,
              generateOptions,
          )
        : createJsonTranslatorFromSchemaDef<T>(
              "AllActions",
              getTranslatorSchemaDefs(
                  actionConfigs,
                  switchActionConfigs,
                  multipleActionOptions,
              ),
              options,
          );

    return createTypeAgentTranslator(translator, options);
}

function createTypeAgentTranslator<
    T extends TranslatedAction = TranslatedAction,
>(
    translator: TypeChatJsonTranslator<T>,
    options: JsonTranslatorOptions<T>,
): TypeAgentTranslator<T> {
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
        translator.validator,
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
        ) => {
            // Expand the request prompt up front with the history and attachments
            const requestPrompt = createTypeAgentRequestPrompt(
                streamingTranslator,
                request,
                history,
                attachments,
            );

            return streamingTranslator.translate(
                requestPrompt,
                history?.promptSections,
                cb,
                attachments,
            );
        },
        // No streaming, no history, no attachments.
        checkTranslate: async (request: string) => {
            const requestPrompt = createTypeAgentRequestPrompt(
                altTranslator,
                request,
                undefined,
                undefined,
                false,
            );
            return altTranslator.translate(requestPrompt);
        },
    };

    return typeAgentTranslator;
}

export function createTypeAgentTranslatorForSelectedActions<
    T extends TranslatedAction = TranslatedAction,
>(
    definitions: ActionSchemaTypeDefinition[],
    actionConfigs: ActionConfig[],
    switchActionConfigs: ActionConfig[],
    schemaName: string,
    provider: ActionConfigProvider,
    multipleActionOptions: MultipleActionOptions,
    model?: string,
) {
    const options = { model };
    const translator = createJsonTranslatorFromActionSchema<T>(
        "AllActions",
        composeSelectedActionSchema(
            definitions,
            actionConfigs,
            switchActionConfigs,
            schemaName,
            provider,
            multipleActionOptions,
        ),
        options,
    );
    return createTypeAgentTranslator<T>(translator, options);
}

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    schemaName: string,
    provider: ActionConfigProvider,
    activeSchemas: string[] = [],
    changeAgentAction: boolean,
    multipleActionOptions: MultipleActionOptions,
    generated: boolean,
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

    if (generated) {
        return generateActionSchema(
            composeActionSchema(
                actionConfigs,
                switchActionConfigs,
                provider,
                multipleActionOptions,
            ),
            { exact: true },
        );
    }
    const schemaDefs = getTranslatorSchemaDefs(
        actionConfigs,
        switchActionConfigs,
        multipleActionOptions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
