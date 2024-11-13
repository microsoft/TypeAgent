// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CachedImageWithDetails,
    createJsonTranslatorFromSchemaDef,
    enableJsonTranslatorStreaming,
} from "common-utils";
import {
    AppAction,
    TranslatorDefinition,
    SchemaDefinition,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { Result } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getMultipleActionSchemaDef } from "./multipleActionSchema.js";
import { TranslatorSchemaDef, composeTranslatorSchemas } from "common-utils";

import registerDebug from "debug";
import { getBuiltinAppAgentConfigs } from "../agent/agentConfig.js";
import { loadTranslatorSchemaConfig } from "../utils/loadSchemaConfig.js";
import { HistoryContext } from "agent-cache";
import { createTypeAgentRequestPrompt } from "../handlers/common/chatHistoryPrompt.js";
import { IncrementalJsonValueCallBack } from "../../../commonUtils/dist/incrementalJsonParser.js";

const debugConfig = registerDebug("typeagent:translator:config");

// A flatten AppAgentManifest
export type TranslatorConfig = {
    emojiChar: string;

    translationDefaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
} & SchemaDefinition;

export interface TranslatorConfigProvider {
    tryGetTranslatorConfig(
        translatorName: string,
    ): TranslatorConfig | undefined;
    getTranslatorConfig(translatorName: string): TranslatorConfig;
    getTranslatorConfigs(): [string, TranslatorConfig][];
}

function collectTranslatorConfigs(
    translatorConfigs: { [key: string]: TranslatorConfig },
    config: TranslatorDefinition,
    name: string,
    emojiChar: string,
    transient: boolean,
    translationDefaultEnabled: boolean,
    actionDefaultEnabled: boolean,
) {
    transient = config.transient ?? transient; // inherit from parent if not specified
    translationDefaultEnabled =
        config.translationDefaultEnabled ??
        config.defaultEnabled ??
        translationDefaultEnabled; // inherit from parent if not specified
    actionDefaultEnabled =
        config.actionDefaultEnabled ??
        config.defaultEnabled ??
        actionDefaultEnabled; // inherit from parent if not specified

    if (config.schema) {
        debugConfig(`Adding translator '${name}'`);
        translatorConfigs[name] = {
            emojiChar,
            ...config.schema,
            transient,
            translationDefaultEnabled,
            actionDefaultEnabled,
        };
    }

    const subTranslators = config.subTranslators;
    if (subTranslators) {
        for (const [subName, subConfig] of Object.entries(subTranslators)) {
            collectTranslatorConfigs(
                translatorConfigs,
                subConfig,
                `${name}.${subName}`,
                emojiChar,
                transient, // propagate default transient
                translationDefaultEnabled, // propagate default translationDefaultEnabled
                actionDefaultEnabled, // propagate default actionDefaultEnabled
            );
        }
    }
}

export function convertToTranslatorConfigs(
    name: string,
    config: AppAgentManifest,
    translatorConfigs: Record<string, TranslatorConfig> = {},
): Record<string, TranslatorConfig> {
    const emojiChar = config.emojiChar;
    collectTranslatorConfigs(
        translatorConfigs,
        config,
        name,
        emojiChar,
        false, // transient default to false if not specified
        true, // translationDefaultEnable default to true if not specified
        true, // actionDefaultEnabled default to true if not specified
    );
    return translatorConfigs;
}

const translatorConfigs: { [key: string]: TranslatorConfig } =
    await (async () => {
        const translatorConfigs = {};
        const configs = await getBuiltinAppAgentConfigs();
        for (const [name, config] of configs.entries()) {
            convertToTranslatorConfigs(name, config, translatorConfigs);
        }
        return translatorConfigs;
    })();

export function getBuiltinTranslatorNames() {
    return Object.keys(translatorConfigs);
}

export function getDefaultBuiltinTranslatorName() {
    // Default to the first translator for now.
    return getBuiltinTranslatorNames()[0];
}

export function getBuiltinTranslatorConfigProvider(): TranslatorConfigProvider {
    return {
        tryGetTranslatorConfig(translatorName: string) {
            return translatorConfigs[translatorName];
        },
        getTranslatorConfig(translatorName: string) {
            const config = translatorConfigs[translatorName];
            if (!config) {
                throw new Error(`Unknown translator: ${translatorName}`);
            }
            return config;
        },
        getTranslatorConfigs() {
            return Object.entries(translatorConfigs);
        },
    };
}

export function loadBuiltinTranslatorSchemaConfig(translatorName: string) {
    return loadTranslatorSchemaConfig(
        translatorName,
        getBuiltinTranslatorConfigProvider(),
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

function getChangeAssistantSchemaDef(
    translatorName: string,
    provider: TranslatorConfigProvider,
    activeTranslators: { [key: string]: boolean },
): TranslatorSchemaDef | undefined {
    // Default to no switching if active translator isn't passed in.
    const translators = provider.getTranslatorConfigs().filter(
        ([name, translatorConfig]) =>
            name !== translatorName && // don't include itself
            !translatorConfig.injected && // don't include injected translators
            (activeTranslators[name] ?? false),
    );
    if (translators.length === 0) {
        return undefined;
    }

    return {
        kind: "inline",
        typeName: changeAssistantActionTypeName,
        schema: `
// Use this ${changeAssistantActionTypeName} if the request is for an action that should be handled by a different assistant
// the assistant will be chosen based on the assistant parameter
export interface ${changeAssistantActionTypeName} {
    actionName: "${changeAssistantActionName}";
    parameters: {
        ${translators
            .map(
                ([name, translator]) =>
                    `// ${name} - ${translator.description}`,
            )
            .join("\n        ")}
        assistant: ${translators.map(([name]) => `"${name}"`).join(" | ")};
        request: string;
    };    
}`,
    };
}

function getTranslatorSchemaDef(
    translatorConfig: TranslatorConfig,
): TranslatorSchemaDef {
    return {
        kind: "file",
        typeName: translatorConfig.schemaType,
        fileName: getPackageFilePath(translatorConfig.schemaFile),
    };
}

function getInjectedTranslatorConfigs(
    translatorName: string,
    provider: TranslatorConfigProvider,
    activeTranslators: { [key: string]: boolean } | undefined,
) {
    if (activeTranslators === undefined) {
        return [];
    }
    return provider
        .getTranslatorConfigs()
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
    provider: TranslatorConfigProvider,
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    // Add all injected schemas
    const injectSchemaConfigs = getInjectedTranslatorConfigs(
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
        ? getMultipleActionSchemaDef(subActionType.join(" | "))
        : undefined;

    if (multipleActionSchemaDef) {
        injectedSchemaDefs.push(multipleActionSchemaDef);
    }

    return injectedSchemaDefs;
}

function getTranslatorSchemaDefs(
    translatorConfig: TranslatorConfig,
    translatorName: string,
    provider: TranslatorConfigProvider,
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    return [
        getTranslatorSchemaDef(translatorConfig),
        ...getInjectedSchemaDefs(
            translatorConfig.schemaType,
            translatorName,
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
export function loadAgentJsonTranslator<T extends object = object>(
    translatorName: string,
    provider: TranslatorConfigProvider,
    model?: string,
    activeTranslators?: { [key: string]: boolean },
    multipleActions: boolean = false,
): TypeAgentTranslator<T> {
    // See if we have a registered factory method for this translator
    const translatorConfig = provider.getTranslatorConfig(translatorName);

    const translator = createJsonTranslatorFromSchemaDef<T>(
        "AllActions",
        getTranslatorSchemaDefs(
            translatorConfig,
            translatorName,
            provider,
            activeTranslators,
            multipleActions,
        ),
        undefined,
        undefined,
        model,
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
    provider: TranslatorConfigProvider,
    changeAssistant: boolean,
    multipleActions: boolean,
) {
    const translatorConfig = provider.getTranslatorConfig(translatorName);
    const schemaDefs = getTranslatorSchemaDefs(
        translatorConfig,
        translatorName,
        provider,
        changeAssistant ? {} : undefined,
        multipleActions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
