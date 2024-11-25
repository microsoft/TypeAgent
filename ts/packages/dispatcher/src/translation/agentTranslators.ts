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
import { Result } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getMultipleActionSchemaDef } from "./multipleActionSchema.js";
import {
    TranslatorSchemaDef,
    composeTranslatorSchemas,
    IncrementalJsonValueCallBack,
} from "common-utils";

import registerDebug from "debug";
import { getBuiltinAppAgentConfigs } from "../agent/agentConfig.js";
import { loadTranslatorSchemaConfig } from "../utils/loadSchemaConfig.js";
import { HistoryContext } from "agent-cache";
import { createTypeAgentRequestPrompt } from "../handlers/common/chatHistoryPrompt.js";
import {
    composeActionSchema,
    createActionJsonTranslatorFromSchemaDef,
} from "./actionSchemaJsonTranslator.js";
import { TranslatedAction } from "../handlers/requestCommandHandler.js";
import {
    ActionSchemaTypeDefinition,
    generateActionSchema,
    generateSchemaTypeDefinition,
    ActionSchemaObject,
    ActionSchemaCreator as sc,
} from "action-schema";
const debugConfig = registerDebug("typeagent:translator:config");

// A flatten AppAgentManifest
export type ActionConfig = {
    emojiChar: string;

    translationDefaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
    schemaName: string;
} & SchemaDefinition;

export interface ActionConfigProvider {
    tryGetActionConfig(schemaName: string): ActionConfig | undefined;
    getActionConfig(schemaName: string): ActionConfig;
    getActionConfigs(): [string, ActionConfig][];
}

function collectActionConfigs(
    actionSchemaConfigs: { [key: string]: ActionConfig },
    manifest: ActionManifest,
    schemaName: string,
    emojiChar: string,
    transient: boolean,
    translationDefaultEnabled: boolean,
    actionDefaultEnabled: boolean,
) {
    transient = manifest.transient ?? transient; // inherit from parent if not specified
    translationDefaultEnabled =
        manifest.translationDefaultEnabled ??
        manifest.defaultEnabled ??
        translationDefaultEnabled; // inherit from parent if not specified
    actionDefaultEnabled =
        manifest.actionDefaultEnabled ??
        manifest.defaultEnabled ??
        actionDefaultEnabled; // inherit from parent if not specified

    if (manifest.schema) {
        debugConfig(`Adding translator '${schemaName}'`);
        actionSchemaConfigs[schemaName] = {
            schemaName,
            emojiChar,
            ...manifest.schema,
            transient,
            translationDefaultEnabled,
            actionDefaultEnabled,
        };
    }

    const subManifests = manifest.subActionManifests;
    if (subManifests) {
        for (const [subName, subManfiest] of Object.entries(subManifests)) {
            collectActionConfigs(
                actionSchemaConfigs,
                subManfiest,
                `${schemaName}.${subName}`,
                emojiChar,
                transient, // propagate default transient
                translationDefaultEnabled, // propagate default translationDefaultEnabled
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

const actionConfigs: { [key: string]: ActionConfig } = await (async () => {
    const configs = {};
    const appAgentConfigs = await getBuiltinAppAgentConfigs();
    for (const [name, config] of appAgentConfigs.entries()) {
        convertToActionConfig(name, config, configs);
    }
    return configs;
})();

export function getBuiltinTranslatorNames() {
    return Object.keys(actionConfigs);
}

export function getDefaultBuiltinTranslatorName() {
    // Default to the first translator for now.
    return getBuiltinTranslatorNames()[0];
}

export function getBuiltinActionConfigProvider(): ActionConfigProvider {
    return {
        tryGetActionConfig(schemaName: string) {
            return actionConfigs[schemaName];
        },
        getActionConfig(schemaName: string) {
            const config = actionConfigs[schemaName];
            if (!config) {
                throw new Error(`Unknown translator: ${schemaName}`);
            }
            return config;
        },
        getActionConfigs() {
            return Object.entries(actionConfigs);
        },
    };
}

export function loadBuiltinTranslatorSchemaConfig(translatorName: string) {
    return loadTranslatorSchemaConfig(
        translatorName,
        getBuiltinActionConfigProvider(),
    );
}

export function getAppAgentName(translatorName: string) {
    return translatorName.split(".")[0];
}

const changeAssistantActionTypeName = "ChangeAssistantAction";
const changeAssistantActionName = "changeAssistantAction";
export type ChangeAssistantAction = {
    actionName: "changeAssistantAction";
    parameters: {
        assistant: string;
        request: string; // this is constrained to active translators in the LLM schema
    };
};

export function isChangeAssistantAction(
    action: AppAction,
): action is ChangeAssistantAction {
    return action.actionName === changeAssistantActionName;
}

const changeAssistantTypeComments = [
    ` Use this ${changeAssistantActionTypeName} if the request is for an action that should be handled by a different assistant.`,
    " The assistant will be chosen based on the assistant parameter",
];
export function createChangeAssistantActionSchema(
    provider: ActionConfigProvider,
    currentSchemaName: string, // schema name to not include
    activeSchemas: { [key: string]: boolean },
): ActionSchemaTypeDefinition | undefined {
    // Default to no switching if active translator isn't passed in.
    const translators = provider.getActionConfigs().filter(
        ([name, actionConfigs]) =>
            name !== currentSchemaName && // don't include itself
            !actionConfigs.injected && // don't include injected translators
            (activeSchemas[name] ?? false),
    );
    if (translators.length === 0) {
        return undefined;
    }

    const assistantParameterComments = translators.map(
        ([name, translator]) => ` ${name} - ${translator.description}`,
    );
    const obj: ActionSchemaObject = sc.obj({
        actionName: sc.string(changeAssistantActionName),
        parameters: sc.obj({
            assistant: sc.field(
                sc.string(translators.map(([name]) => name)),
                assistantParameterComments,
            ),
            request: sc.string(),
        }),
    } as const);
    return sc.intf(
        changeAssistantActionTypeName,
        obj,
        changeAssistantTypeComments,
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
        typeName: changeAssistantActionTypeName,
        schema: generateSchemaTypeDefinition(definition, { exact: true }),
    };
}

function getTranslatorSchemaDef(
    actionConfig: ActionConfig,
): TranslatorSchemaDef {
    return {
        kind: "file",
        typeName: actionConfig.schemaType,
        fileName: getPackageFilePath(actionConfig.schemaFile),
    };
}

export function getInjectedActionConfigs(
    translatorName: string,
    provider: ActionConfigProvider,
    activeTranslators: { [key: string]: boolean } | undefined,
) {
    if (activeTranslators === undefined) {
        return [];
    }
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
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    // Add all injected schemas
    const injectSchemaConfigs = getInjectedActionConfigs(
        translatorName,
        provider,
        activeTranslators,
    );
    const injectedSchemaDefs = injectSchemaConfigs.map(getTranslatorSchemaDef);

    // subAction for multiple action
    const subActionType = [type, ...injectedSchemaDefs.map((s) => s.typeName)];

    // Add change assistant schema if needed
    const changeAssistantSchemaDef = activeTranslators
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
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    const actionConfig = provider.getActionConfig(schemaName);
    return [
        getTranslatorSchemaDef(actionConfig),
        ...getInjectedSchemaDefs(
            actionConfig.schemaType,
            schemaName,
            provider,
            activeTranslators,
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
    model?: string,
    activeTranslators?: { [key: string]: boolean },
    multipleActions: boolean = false,
    regenerateSchema: boolean = false,
): TypeAgentTranslator<T> {
    const translator = regenerateSchema
        ? createActionJsonTranslatorFromSchemaDef<T>(
              "AllActions",
              composeActionSchema(
                  translatorName,
                  provider,
                  activeTranslators,
                  multipleActions,
              ),
              { model },
          )
        : createJsonTranslatorFromSchemaDef<T>(
              "AllActions",
              getTranslatorSchemaDefs(
                  translatorName,
                  provider,
                  activeTranslators,
                  multipleActions,
              ),
              { model },
          );

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

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    translatorName: string,
    provider: ActionConfigProvider,
    activeSchemas: string[] | undefined,
    multipleActions: boolean,
    generated: boolean,
): string {
    const active = activeSchemas
        ? Object.fromEntries(activeSchemas.map((name) => [name, true]))
        : undefined;
    if (generated) {
        return generateActionSchema(
            composeActionSchema(
                translatorName,
                provider,
                active,
                multipleActions,
            ),
            { exact: true },
        );
    }
    const schemaDefs = getTranslatorSchemaDefs(
        translatorName,
        provider,
        active,
        multipleActions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
