// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorFromSchemaDef } from "common-utils";
import {
    DispatcherAction,
    HierarchicalTranslatorConfig,
} from "@typeagent/agent-sdk";
import { TypeChatJsonTranslator } from "typechat";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getMultipleActionSchemaDef } from "./systemActionsInlineSchema.js";
import { TranslatorSchemaDef, composeTranslatorSchemas } from "common-utils";
import { getTranslatorActionInfo } from "./actionInfo.js";

import registerDebug from "debug";
import { getDispatcherAgentConfigs } from "../agent/agentConfig.js";

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
};

function collectTranslatorConfigs(
    translatorConfigs: { [key: string]: TranslatorConfig },
    config: HierarchicalTranslatorConfig,
    name: string,
    emojiChar: string,
    defaultEnabled: boolean,
    actionDefaultEnabled: boolean,
) {
    defaultEnabled = config.defaultEnabled ?? defaultEnabled;
    actionDefaultEnabled = config.actionDefaultEnabled ?? actionDefaultEnabled;

    if (config.schema) {
        debugConfig(`Adding translator '${name}'`);
        translatorConfigs[name] = {
            emojiChar,
            ...config.schema,
            defaultEnabled,
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
                defaultEnabled,
                actionDefaultEnabled,
            );
        }
    }
}

const translatorConfigs: { [key: string]: TranslatorConfig } =
    await (async () => {
        const translatorConfigs = {};
        const configs = await getDispatcherAgentConfigs();
        for (const [name, config] of configs.entries()) {
            const emojiChar = config.emojiChar;
            collectTranslatorConfigs(
                translatorConfigs,
                config,
                name,
                emojiChar,
                true, // default to true if not specified
                true, // default to true if not specified
            );
        }
        return translatorConfigs;
    })();

export function getTranslatorNames() {
    return Object.keys(translatorConfigs);
}

export function getDefaultTranslatorName() {
    // Default to the first translator for now.
    return getTranslatorNames()[0];
}

export function getTranslatorConfigs() {
    return Object.entries(translatorConfigs);
}

export function getDispatcherAgentName(translatorName: string) {
    return translatorName.split(".")[0];
}

export function getTranslatorConfig(translatorName: string): TranslatorConfig {
    const config = translatorConfigs[translatorName];

    if (config === undefined) {
        throw new Error(`Translator '${translatorName}' not found in config`);
    }
    return config;
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
        request: string; // this is constrainted to active translators in the LLM schema
    };
};

export function isChangeAssistantAction(
    action: DispatcherAction,
): action is ChangeAssistantAction {
    return action.actionName === changeAssistantActionName;
}

function getChangeAssistantSchemaDef(
    translatorName: string,
    activeTranslators: { [key: string]: boolean },
): TranslatorSchemaDef | undefined {
    // Default to no switching if active translator isn't passed in.
    const translators = getTranslatorConfigs().filter(
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

let injectedTranslatorConfig: [string, TranslatorConfig][] | undefined;
const injectedTranslatorForActionName = new Map<string, string>();
function ensureInjectedTranslatorConfig() {
    if (injectedTranslatorConfig === undefined) {
        // Cache some info.
        injectedTranslatorConfig = getTranslatorConfigs().filter(
            ([_, config]) => config.injected,
        );

        for (const [name, config] of injectedTranslatorConfig) {
            for (const info of getTranslatorActionInfo(config, name)) {
                injectedTranslatorForActionName.set(info.name, name);
            }
        }
    }
    return injectedTranslatorConfig;
}

function getInjectedTranslatorConfigs(
    activeTranslators: { [key: string]: boolean } | undefined,
) {
    if (activeTranslators === undefined) {
        return [];
    }
    return ensureInjectedTranslatorConfig()
        .filter(
            ([name, config]) =>
                activeTranslators[name] ?? config.defaultEnabled,
        )
        .map(([_, config]) => config);
}

export function getInjectedTranslatorForActionName(actionName: string) {
    ensureInjectedTranslatorConfig();
    return injectedTranslatorForActionName.get(actionName);
}

function getInjectedSchemaDefs(
    type: string,
    translatorName: string,
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    // Add all injected schemas
    const injectSchemaConfigs = getInjectedTranslatorConfigs(activeTranslators);
    const injectedSchemaDefs = injectSchemaConfigs.map(getTranslatorSchemaDef);

    // subAction for multiple action
    const subActionType = [type, ...injectedSchemaDefs.map((s) => s.typeName)];

    // Add change assistant schema if needed
    const changeAssistantSchemaDef = activeTranslators
        ? getChangeAssistantSchemaDef(translatorName, activeTranslators)
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
    activeTranslators: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
): TranslatorSchemaDef[] {
    return [
        getTranslatorSchemaDef(translatorConfig),
        ...getInjectedSchemaDefs(
            translatorConfig.schemaType,
            translatorName,
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
    model?: string,
    activeTranslators?: { [key: string]: boolean },
    multipleActions: boolean = false,
) {
    const translatorConfig = getTranslatorConfig(translatorName);
    // See if we have a registered factory method for this translator
    const factory = translatorFactories[translatorConfig.schemaType];
    if (factory) {
        return factory(translatorConfig);
    }

    return createJsonTranslatorFromSchemaDef(
        "AllActions",
        getTranslatorSchemaDefs(
            translatorConfig,
            translatorName,
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
    changeAssistant: boolean,
    multipleActions: boolean,
) {
    const translatorConfig = getTranslatorConfig(translatorName);
    if (translatorFactories[translatorConfig.schemaType] !== undefined) {
        throw new Error("Can't get schema for customfactory");
    }
    const schemaDefs = getTranslatorSchemaDefs(
        translatorConfig,
        translatorName,
        changeAssistant ? {} : undefined,
        multipleActions,
    );
    return composeTranslatorSchemas("AllActions", schemaDefs);
}
