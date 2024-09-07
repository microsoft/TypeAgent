// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorFromSchemaDef } from "common-utils";
import {
    AppAction,
    HierarchicalTranslatorConfig,
    TopLevelTranslatorConfig,
} from "@typeagent/agent-sdk";
import { TypeChatJsonTranslator } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getMultipleActionSchemaDef } from "./systemActionsInlineSchema.js";
import { TranslatorSchemaDef, composeTranslatorSchemas } from "common-utils";

import registerDebug from "debug";
import { getBuiltinAppAgentConfigs } from "../agent/agentConfig.js";
import { loadTranslatorSchemaConfig } from "../utils/loadSchemaConfig.js";

const debugConfig = registerDebug("typeagent:translator:config");

export type TranslatorConfig = {
    emojiChar: string;
    description: string;
    schemaFile: string;
    schemaType: string;
    constructions?: {
        data: string[];
        file: string;
    };
    dataFrameColumns?: { [key: string]: string };
    injected?: boolean; // whether the translator is injected into other domains, default is false
    cached?: boolean; // whether the translator's action should be cached, default is true
    streamingActions?: string[];

    defaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
};

export interface TranslatorConfigProvider {
    getTranslatorConfig(translatorName: string): TranslatorConfig;
    getTranslatorConfigs(): [string, TranslatorConfig][];
}

function collectTranslatorConfigs(
    translatorConfigs: { [key: string]: TranslatorConfig },
    config: HierarchicalTranslatorConfig,
    name: string,
    emojiChar: string,
    defaultEnabled: boolean,
    actionDefaultEnabled: boolean,
    transient: boolean,
) {
    defaultEnabled = config.defaultEnabled ?? defaultEnabled;
    actionDefaultEnabled = config.actionDefaultEnabled ?? actionDefaultEnabled;
    transient = config.transient ?? transient;

    if (config.schema) {
        debugConfig(`Adding translator '${name}'`);
        translatorConfigs[name] = {
            emojiChar,
            ...config.schema,
            defaultEnabled,
            actionDefaultEnabled,
            transient,
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
                defaultEnabled,
                actionDefaultEnabled,
                transient,
            );
        }
    }
}

export function convertToTranslatorConfigs(
    name: string,
    config: TopLevelTranslatorConfig,
): Record<string, TranslatorConfig> {
    const translatorConfigs: Record<string, TranslatorConfig> = {};
    const emojiChar = config.emojiChar;
    collectTranslatorConfigs(
        translatorConfigs,
        config,
        name,
        emojiChar,
        true, // default to true if not specified
        true, // default to true if not specified
        false, // default to false if not specified
    );
    return translatorConfigs;
}

const translatorConfigs: { [key: string]: TranslatorConfig } =
    await (async () => {
        const translatorConfigs = {};
        const configs = await getBuiltinAppAgentConfigs();
        for (const [name, config] of configs.entries()) {
            const emojiChar = config.emojiChar;
            collectTranslatorConfigs(
                translatorConfigs,
                config,
                name,
                emojiChar,
                true, // default to true if not specified
                true, // default to true if not specified
                false, // default to false if not specified
            );
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

// A list of translator factory methods, keyed by the config.SchemaType name
const translatorFactories: {
    [key: string]: (config: TranslatorConfig) => TypeChatJsonTranslator<Object>;
} = {};

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
            (activeTranslators[name] ?? translatorConfig.defaultEnabled), // use the config default if key is missing
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
                (activeTranslators[name] ?? config.defaultEnabled),
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

/**
 *
 * @param translatorName name to get the translator for.
 * @param activeTranslators The set of active translators to include for injected and change assistant actions. Default to false if undefined.
 * @param multipleActions Add the multiple action schema if true. Default to false.
 * @returns
 */
export function loadAgentJsonTranslator(
    translatorName: string,
    provider: TranslatorConfigProvider,
    model?: string,
    activeTranslators?: { [key: string]: boolean },
    multipleActions: boolean = false,
) {
    // See if we have a registered factory method for this translator
    const translatorConfig = provider.getTranslatorConfig(translatorName);
    const factory = translatorFactories[translatorConfig.schemaType];
    if (factory) {
        return factory(translatorConfig);
    }

    return createJsonTranslatorFromSchemaDef(
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
}

// For CLI, replicate the behavior of loadAgentJsonTranslator to get the schema
export function getFullSchemaText(
    translatorName: string,
    provider: TranslatorConfigProvider,
    changeAssistant: boolean,
    multipleActions: boolean,
) {
    const translatorConfig = provider.getTranslatorConfig(translatorName);
    if (translatorFactories[translatorConfig.schemaType] !== undefined) {
        throw new Error("Can't get schema for customfactory");
    }
    const schemaDefs = getTranslatorSchemaDefs(
        translatorConfig,
        translatorName,
        provider,
        changeAssistant ? {} : undefined,
        multipleActions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
