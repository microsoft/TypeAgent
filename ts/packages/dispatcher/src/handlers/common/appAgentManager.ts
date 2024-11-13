// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    convertToTranslatorConfigs,
    getAppAgentName,
    TranslatorConfig,
    TranslatorConfigProvider,
} from "../../translation/agentTranslators.js";
import { createSessionContext } from "../../action/actionHandlers.js";
import { AppAgentProvider } from "../../agent/agentProvider.js";
import registerDebug from "debug";
import { getTranslatorActionSchemas } from "../../translation/actionSchema.js";
import { DeepPartialUndefinedAndNull } from "common-utils";
import { DispatcherName } from "./interactiveIO.js";

const debug = registerDebug("typeagent:agents");
const debugError = registerDebug("typeagent:agents:error");

type AppAgentRecord = {
    name: string;
    provider: AppAgentProvider;
    translators: Set<string>;
    actions: Set<string>;
    commands: boolean;
    hasTranslators: boolean;
    manifest: AppAgentManifest;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
};

export type AppAgentState = {
    translators: Record<string, boolean> | undefined;
    actions: Record<string, boolean> | undefined;
    commands: Record<string, boolean> | undefined;
};

export type AppAgentStateOptions = DeepPartialUndefinedAndNull<AppAgentState>;

function getEffectiveValue(
    force: AppAgentStateOptions | undefined,
    overrides: AppAgentStateOptions | undefined,
    kind: "translators" | "actions" | "commands",
    name: string,
    useDefault: boolean,
    defaultValue: boolean,
    currentValue: boolean,
): boolean {
    const forceState = force?.[kind];
    if (forceState !== undefined) {
        // false if forceState is null or the value is missing.
        return forceState?.[name] ?? false;
    }

    const enabled = overrides?.[kind]?.[name];
    if (enabled === undefined) {
        return useDefault ? defaultValue : currentValue;
    }
    // null means default value
    return enabled ?? defaultValue;
}

export type SetStateResult = {
    changed: {
        translators: [string, boolean][];
        actions: [string, boolean][];
        commands: [string, boolean][];
    };
    failed: {
        actions: [string, boolean, Error][];
        commands: [string, boolean, Error][];
    };
};

export const alwaysEnabledAgents = {
    translators: [DispatcherName],
    actions: [DispatcherName],
    commands: ["system"],
};

export class AppAgentManager implements TranslatorConfigProvider {
    private readonly agents = new Map<string, AppAgentRecord>();
    private readonly translatorConfigs = new Map<string, TranslatorConfig>();
    private readonly injectedTranslatorForActionName = new Map<
        string,
        string
    >();
    private readonly emojis: Record<string, string> = {};
    private readonly transientAgents: Record<string, boolean | undefined> = {};

    public getAppAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    public getAppAgentDescription(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.manifest.description;
    }

    public isTranslatorEnabled(translatorName: string) {
        const appAgentName = getAppAgentName(translatorName);
        const record = this.getRecord(appAgentName);
        return record.translators.has(translatorName);
    }

    public isTranslatorActive(translatorName: string) {
        return (
            this.isTranslatorEnabled(translatorName) &&
            this.transientAgents[translatorName] !== false
        );
    }

    public getActiveTranslators() {
        return this.getTranslatorNames().filter((name) =>
            this.isTranslatorActive(name),
        );
    }

    public isActionActive(translatorName: string) {
        return (
            this.isActionEnabled(translatorName) &&
            this.transientAgents[translatorName] !== false
        );
    }

    private isActionEnabled(translatorName: string) {
        const appAgentName = getAppAgentName(translatorName);
        const record = this.getRecord(appAgentName);
        return record.actions.has(translatorName);
    }

    public isCommandEnabled(appAgentName: string) {
        const record = this.agents.get(appAgentName);
        return record !== undefined
            ? record.commands && record.appAgent?.executeCommand !== undefined
            : false;
    }

    public getEmojis(): Readonly<Record<string, string>> {
        return this.emojis;
    }

    public async addProvider(
        provider: AppAgentProvider,
        context: CommandHandlerContext,
    ) {
        for (const name of provider.getAppAgentNames()) {
            // TODO: detect duplicate names
            const manifest = await provider.getAppAgentManifest(name);
            this.emojis[name] = manifest.emojiChar;

            // TODO: detect duplicate names
            const translatorConfigs = convertToTranslatorConfigs(
                name,
                manifest,
            );

            const entries = Object.entries(translatorConfigs);
            for (const [name, config] of entries) {
                this.translatorConfigs.set(name, config);
                this.emojis[name] = config.emojiChar;

                if (config.transient) {
                    this.transientAgents[name] = false;
                }
                if (config.injected) {
                    const actionInfos = getTranslatorActionSchemas(
                        config,
                        name,
                    );
                    for (const info of actionInfos.values()) {
                        this.injectedTranslatorForActionName.set(
                            info.actionName,
                            name,
                        );
                    }
                }
            }

            const record: AppAgentRecord = {
                name,
                provider,
                actions: new Set(),
                translators: new Set(),
                commands: false,
                hasTranslators: entries.length > 0,
                manifest,
            };

            this.agents.set(name, record);
        }
    }

    public tryGetTranslatorConfig(mayBeTranslatorName: string) {
        return this.translatorConfigs.get(mayBeTranslatorName);
    }
    public getTranslatorConfig(translatorName: string) {
        const config = this.tryGetTranslatorConfig(translatorName);
        if (config === undefined) {
            throw new Error(`Unknown translator: ${translatorName}`);
        }
        return config;
    }

    public getTranslatorNames() {
        return Array.from(this.translatorConfigs.keys());
    }
    public getTranslatorConfigs() {
        return Array.from(this.translatorConfigs.entries());
    }

    public getInjectedTranslatorForActionName(actionName: string) {
        return this.injectedTranslatorForActionName.get(actionName);
    }

    public getAppAgent(appAgentName: string): AppAgent {
        const record = this.getRecord(appAgentName);
        if (record.appAgent === undefined) {
            throw new Error(`App agent ${appAgentName} is not initialized`);
        }
        return record.appAgent;
    }

    public getSessionContext(appAgentName: string): SessionContext {
        const record = this.getRecord(appAgentName);
        if (record.sessionContext === undefined) {
            throw new Error(
                `Session context for ${appAgentName} is not initialized`,
            );
        }
        return record.sessionContext;
    }

    public async setState(
        context: CommandHandlerContext,
        overrides?: AppAgentStateOptions,
        force?: AppAgentStateOptions,
        useDefault: boolean = true,
    ): Promise<SetStateResult> {
        const changedTranslators: [string, boolean][] = [];
        const failedTranslators: [string, boolean, Error][] = [];
        const changedActions: [string, boolean][] = [];
        const failedActions: [string, boolean, Error][] = [];
        const changedCommands: [string, boolean][] = [];
        const failedCommands: [string, boolean, Error][] = [];

        const p: Promise<void>[] = [];
        for (const [name, config] of this.translatorConfigs) {
            const record = this.getRecord(getAppAgentName(name));

            const currentTranslatorEnabled = record.translators.has(name);
            const enableTranslator = getEffectiveValue(
                force,
                overrides,
                "translators",
                name,
                useDefault,
                config.translationDefaultEnabled,
                currentTranslatorEnabled,
            );

            if (enableTranslator !== currentTranslatorEnabled) {
                if (enableTranslator) {
                    record.translators.add(name);
                    changedTranslators.push([name, enableTranslator]);
                } else if (!alwaysEnabledAgents.translators.includes(name)) {
                    record.translators.delete(name);
                    changedTranslators.push([name, enableTranslator]);
                } else {
                    failedTranslators.push([
                        name,
                        enableTranslator,
                        new Error(`Cannot disable ${name} translator`),
                    ]);
                }
            }

            const currentActionEnabled = record.actions.has(name);
            const enableAction = getEffectiveValue(
                force,
                overrides,
                "actions",
                name,
                useDefault,
                config.actionDefaultEnabled,
                currentActionEnabled,
            );

            if (enableAction !== currentActionEnabled) {
                p.push(
                    (async () => {
                        try {
                            await this.updateAction(
                                name,
                                record,
                                enableAction,
                                context,
                            );
                            changedActions.push([name, enableAction]);
                        } catch (e: any) {
                            failedActions.push([name, enableAction, e]);
                        }
                    })(),
                );
            }
        }

        for (const record of this.agents.values()) {
            const currentCommandsEnabled = record.commands;
            const enableCommands = getEffectiveValue(
                force,
                overrides,
                "commands",
                record.name,
                useDefault,
                record.manifest.commandDefaultEnabled ??
                    record.manifest.defaultEnabled ??
                    true,
                currentCommandsEnabled,
            );

            if (enableCommands !== currentCommandsEnabled) {
                if (enableCommands) {
                    p.push(
                        (async () => {
                            try {
                                await this.ensureSessionContext(
                                    record,
                                    context,
                                );
                                record.commands = true;
                                changedCommands.push([
                                    record.name,
                                    enableCommands,
                                ]);
                            } catch (e: any) {
                                failedCommands.push([
                                    record.name,
                                    enableCommands,
                                    e,
                                ]);
                            }
                        })(),
                    );
                } else {
                    if (alwaysEnabledAgents.commands.includes(record.name)) {
                        failedCommands.push([
                            record.name,
                            enableCommands,
                            new Error(`Cannot disable ${record.name} commands`),
                        ]);
                    } else {
                        record.commands = false;
                        changedCommands.push([record.name, enableCommands]);
                        await this.checkCloseSessionContext(record);
                    }
                }
            }
        }

        await Promise.all(p);
        return {
            changed: {
                translators: changedTranslators,
                actions: changedActions,
                commands: changedCommands,
            },
            failed: {
                actions: failedActions,
                commands: failedCommands,
            },
        };
    }

    public getTransientState(translatorName: string) {
        return this.transientAgents[translatorName];
    }

    public toggleTransient(translatorName: string, enable: boolean) {
        if (this.transientAgents[translatorName] === undefined) {
            throw new Error(`Transient sub agent not found: ${translatorName}`);
        }
        debug(
            `Toggle transient agent '${translatorName}' to ${enable ? "enabled" : "disabled"}`,
        );
        this.transientAgents[translatorName] = enable;
    }
    public async close() {
        for (const record of this.agents.values()) {
            record.actions.clear();
            record.commands = false;
            await this.closeSessionContext(record);
        }
    }

    private async updateAction(
        translatorName: string,
        record: AppAgentRecord,
        enable: boolean,
        context: CommandHandlerContext,
    ) {
        if (enable) {
            if (record.actions.has(translatorName)) {
                return;
            }

            record.actions.add(translatorName);
            try {
                const sessionContext = await this.ensureSessionContext(
                    record,
                    context,
                );
                await record.appAgent!.updateAgentContext?.(
                    enable,
                    sessionContext,
                    translatorName,
                );
            } catch (e) {
                // Rollback if there is a exception
                record.actions.delete(translatorName);
                throw e;
            }
            debug(`Enabled ${translatorName}`);
        } else {
            if (alwaysEnabledAgents.actions.includes(translatorName)) {
                throw new Error(`Cannot disable ${translatorName} actions`);
            }
            if (!record.actions.has(translatorName)) {
                return;
            }
            record.actions.delete(translatorName);
            const sessionContext = await record.sessionContextP!;
            try {
                await record.appAgent!.updateAgentContext?.(
                    enable,
                    sessionContext,
                    translatorName,
                );
            } finally {
                // Assume that it is disabled even when there is an exception
                debug(`Disabled ${translatorName}`);
                await this.checkCloseSessionContext(record);
            }
        }
    }

    private async ensureSessionContext(
        record: AppAgentRecord,
        context: CommandHandlerContext,
    ) {
        if (record.sessionContextP === undefined) {
            record.sessionContextP = this.initializeSessionContext(
                record,
                context,
            );
        }

        return record.sessionContextP;
    }
    private async initializeSessionContext(
        record: AppAgentRecord,
        context: CommandHandlerContext,
    ) {
        const appAgent = await this.ensureAppAgent(record);
        const agentContext = await appAgent.initializeAgentContext?.();
        record.sessionContext = createSessionContext(
            record.name,
            agentContext,
            context,
        );

        debug(`Session context created for ${record.name}`);
        return record.sessionContext;
    }

    private async checkCloseSessionContext(record: AppAgentRecord) {
        if (record.actions.size === 0 && !record.commands) {
            await this.closeSessionContext(record);
        }
    }
    private async closeSessionContext(record: AppAgentRecord) {
        if (record.sessionContextP !== undefined) {
            const sessionContext = await record.sessionContextP;
            record.sessionContext = undefined;
            record.sessionContextP = undefined;
            try {
                await record.appAgent!.closeAgentContext?.(sessionContext);
                // TODO: unload agent as well?
                debug(`Session context closed for ${record.name}`);
            } catch (e) {
                debugError(
                    `Failed to close session context for ${record.name}. Error ignored`,
                    e,
                );
                // Ignore error
            }
        }
    }

    private async ensureAppAgent(record: AppAgentRecord) {
        if (record.appAgent === undefined) {
            record.appAgent = await record.provider.loadAppAgent(record.name);
        }
        return record.appAgent;
    }

    private getRecord(appAgentName: string) {
        const record = this.agents.get(appAgentName);
        if (record === undefined) {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return record;
    }
}
