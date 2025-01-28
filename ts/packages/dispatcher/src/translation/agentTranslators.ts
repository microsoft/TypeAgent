// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CachedImageWithDetails,
    createJsonTranslatorFromSchemaDef,
    enableJsonTranslatorStreaming,
} from "common-utils";
import {
    AppAction,
    ActionManifest,
    SchemaDefinition,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { Result, TypeChatJsonTranslator } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getMultipleActionSchemaDef } from "./multipleActionSchema.js";
import {
    TranslatorSchemaDef,
    composeTranslatorSchemas,
    IncrementalJsonValueCallBack,
} from "common-utils";

import registerDebug from "debug";
import { HistoryContext, ParamObjectType } from "agent-cache";
import { createTypeAgentRequestPrompt } from "../context/chatHistoryPrompt.js";
import {
    composeActionSchema,
    composeSelectedActionSchema,
    createActionJsonTranslatorFromSchemaDef,
} from "./actionSchemaJsonTranslator.js";
import {
    ActionSchemaTypeDefinition,
    generateActionSchema,
    generateSchemaTypeDefinition,
    ActionSchemaObject,
    ActionSchemaCreator as sc,
    ActionSchemaFile,
} from "action-schema";
const debugConfig = registerDebug("typeagent:dispatcher:schema:config");

// A flatten AppAgentManifest
export type ActionConfig = {
    emojiChar: string;

    schemaDefaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
    schemaName: string;
} & SchemaDefinition;

export interface ActionConfigProvider {
    tryGetActionConfig(schemaName: string): ActionConfig | undefined;
    getActionConfig(schemaName: string): ActionConfig;
    getActionConfigs(): [string, ActionConfig][];
    getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile;
}

function isValidSubSchemaName(schemaNamePart: string) {
    // . is use as a sub-schema separator
    // | is used in the cache as as multiple schema name separator
    // , is used in the cache as a separator between schema name and its hash
    return !/[.|,]/.test(schemaNamePart);
}

function collectActionConfigs(
    actionConfigs: { [key: string]: ActionConfig },
    manifest: ActionManifest,
    schemaName: string,
    emojiChar: string,
    transient: boolean,
    schemaDefaultEnabled: boolean,
    actionDefaultEnabled: boolean,
) {
    transient = manifest.transient ?? transient; // inherit from parent if not specified
    schemaDefaultEnabled =
        manifest.schemaDefaultEnabled ??
        manifest.defaultEnabled ??
        schemaDefaultEnabled; // inherit from parent if not specified
    actionDefaultEnabled =
        manifest.actionDefaultEnabled ??
        manifest.defaultEnabled ??
        actionDefaultEnabled; // inherit from parent if not specified

    if (manifest.schema) {
        debugConfig(`Adding schema '${schemaName}'`);
        actionConfigs[schemaName] = {
            schemaName,
            emojiChar,
            ...manifest.schema,
            transient,
            schemaDefaultEnabled,
            actionDefaultEnabled,
        };
    }

    const subManifests = manifest.subActionManifests;
    if (subManifests) {
        for (const [subName, subManfiest] of Object.entries(subManifests)) {
            if (!isValidSubSchemaName(subName)) {
                throw new Error(`Invalid sub-schema name: ${subName}`);
            }
            collectActionConfigs(
                actionConfigs,
                subManfiest,
                `${schemaName}.${subName}`,
                emojiChar,
                transient, // propagate default transient
                schemaDefaultEnabled, // propagate default schemaDefaultEnabled
                actionDefaultEnabled, // propagate default actionDefaultEnabled
            );
        }
    }
}

export function convertToActionConfig(
    name: string,
    config: AppAgentManifest,
    actionConfigs: Record<string, ActionConfig> = {},
): Record<string, ActionConfig> {
    if (!isValidSubSchemaName(name)) {
        throw new Error(`Invalid schema name: ${name}`);
    }
    const emojiChar = config.emojiChar;
    collectActionConfigs(
        actionConfigs,
        config,
        name,
        emojiChar,
        false, // transient default to false if not specified
        true, // translationDefaultEnable default to true if not specified
        true, // actionDefaultEnabled default to true if not specified
    );
    return actionConfigs;
}

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
    provider: ActionConfigProvider,
    currentSchemaName: string, // schema name to not include
    activeSchemas: { [key: string]: boolean },
    partial: boolean = false,
): ActionSchemaTypeDefinition | undefined {
    // Default to no switching if active translator isn't passed in.
    const translators = provider.getActionConfigs().filter(
        ([name, actionConfigs]) =>
            (partial && name === currentSchemaName) || // include itself if partial
            (name !== currentSchemaName && // don't include itself
                !actionConfigs.injected && // don't include injected translators
                (activeSchemas[name] ?? false)),
    );
    if (translators.length === 0) {
        return undefined;
    }

    const schemaNameParameterComments = translators.map(
        ([name, translator]) => ` ${name} - ${translator.description}`,
    );
    const obj: ActionSchemaObject = sc.obj({
        actionName: sc.string(additionalActionLookup),
        parameters: sc.obj({
            schemaName: sc.field(
                sc.string(translators.map(([name]) => name)),
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
    currentTranslatorName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean },
): TranslatorSchemaDef | undefined {
    const definition = createChangeAssistantActionSchema(
        provider,
        currentTranslatorName,
        activeTranslators,
    );
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

export function getInjectedActionConfigs(
    translatorName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean },
) {
    return provider
        .getActionConfigs()
        .filter(
            ([name, config]) =>
                config.injected &&
                name !== translatorName && // don't include itself
                (activeTranslators[name] ?? false),
        )
        .map(([_, config]) => config);
}

function getInjectedSchemaDefs(
    type: string,
    translatorName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean },
    changeAgentAction: boolean,
    multipleActions: boolean,
): TranslatorSchemaDef[] {
    // Add all injected schemas
    const injectedActionConfigs = getInjectedActionConfigs(
        translatorName,
        provider,
        activeTranslators,
    );
    const injectedSchemaDefs = injectedActionConfigs.map(
        getTranslatorSchemaDef,
    );

    // subAction for multiple action
    const subActionType = [type, ...injectedSchemaDefs.map((s) => s.typeName)];

    // Add change assistant schema if needed
    const changeAssistantSchemaDef = changeAgentAction
        ? getChangeAssistantSchemaDef(
              translatorName,
              provider,
              activeTranslators,
          )
        : undefined;

    if (changeAssistantSchemaDef) {
        injectedSchemaDefs.push(changeAssistantSchemaDef);
        subActionType.push(changeAssistantSchemaDef.typeName);
    }

    // Add multiple action schema
    const multipleActionSchemaDef = multipleActions
        ? getMultipleActionSchemaDef(subActionType)
        : undefined;

    if (multipleActionSchemaDef) {
        injectedSchemaDefs.push(multipleActionSchemaDef);
    }

    return injectedSchemaDefs;
}

function getTranslatorSchemaDefs(
    schemaName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean },
    changeAgentAction: boolean,
    multipleActions: boolean,
): TranslatorSchemaDef[] {
    const actionConfig = provider.getActionConfig(schemaName);
    return [
        getTranslatorSchemaDef(actionConfig),
        ...getInjectedSchemaDefs(
            actionConfig.schemaType,
            schemaName,
            provider,
            activeTranslators,
            changeAgentAction,
            multipleActions,
        ),
    ];
}

export type TypeAgentTranslator<T = object> = {
    translate: (
        request: string,
        history?: HistoryContext,
        attachments?: CachedImageWithDetails[],
        cb?: IncrementalJsonValueCallBack,
    ) => Promise<Result<T>>;
};

// TranslatedAction are actions returned from the LLM without the translator name
export interface TranslatedAction {
    actionName: string;
    parameters?: ParamObjectType;
}

/**
 *
 * @param translatorName name to get the translator for.
 * @param activeTranslators The set of active translators to include for injected and change assistant actions. Default to false if undefined.
 * @param multipleActions Add the multiple action schema if true. Default to false.
 * @returns
 */
export function loadAgentJsonTranslator<
    T extends TranslatedAction = TranslatedAction,
>(
    translatorName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean } = {},
    changeAgentAction: boolean = false,
    multipleActions: boolean = false,
    regenerateSchema: boolean = true,
    model?: string,
    exact: boolean = true,
): TypeAgentTranslator<T> {
    const translator = regenerateSchema
        ? createActionJsonTranslatorFromSchemaDef<T>(
              "AllActions",
              composeActionSchema(
                  translatorName,
                  provider,
                  activeTranslators,
                  changeAgentAction,
                  multipleActions,
              ),
              { model },
              { exact },
          )
        : createJsonTranslatorFromSchemaDef<T>(
              "AllActions",
              getTranslatorSchemaDefs(
                  translatorName,
                  provider,
                  activeTranslators,
                  changeAgentAction,
                  multipleActions,
              ),
              { model },
          );

    return createTypeAgentTranslator(translator);
}

function createTypeAgentTranslator<
    T extends TranslatedAction = TranslatedAction,
>(translator: TypeChatJsonTranslator<T>): TypeAgentTranslator<T> {
    const streamingTranslator = enableJsonTranslatorStreaming(translator);

    // the request prompt is already expanded by the override replacement below
    // So just return the request as is.
    streamingTranslator.createRequestPrompt = (request: string) => {
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
    };

    return typeAgentTranslator;
}

export function createTypeAgentTranslatorForSelectedActions<
    T extends TranslatedAction = TranslatedAction,
>(
    definitions: ActionSchemaTypeDefinition[],
    schemaName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean },
    changeAgentAction: boolean,
    multipleActions: boolean,
    model?: string,
) {
    const translator = createActionJsonTranslatorFromSchemaDef<T>(
        "AllActions",
        composeSelectedActionSchema(
            definitions,
            schemaName,
            provider,
            activeTranslators,
            changeAgentAction,
            multipleActions,
        ),
        { model },
    );
    return createTypeAgentTranslator<T>(translator);
}

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    translatorName: string,
    provider: ActionConfigProvider,
    activeSchemas: string[] = [],
    changeAgentAction: boolean,
    multipleActions: boolean,
    generated: boolean,
): string {
    const active = Object.fromEntries(
        activeSchemas.map((name) => [name, true]),
    );

    if (generated) {
        return generateActionSchema(
            composeActionSchema(
                translatorName,
                provider,
                active,
                changeAgentAction,
                multipleActions,
            ),
            { exact: true },
        );
    }
    const schemaDefs = getTranslatorSchemaDefs(
        translatorName,
        provider,
        active,
        changeAgentAction,
        multipleActions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
