// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    convertToActionConfig,
    getAppAgentName,
    ActionConfig,
    ActionConfigProvider,
} from "../../translation/agentTranslators.js";
import { createSessionContext } from "../../action/actionHandlers.js";
import { AppAgentProvider } from "../../agent/agentProvider.js";
import registerDebug from "debug";
import { DeepPartialUndefinedAndNull } from "common-utils";
import { DispatcherName } from "./interactiveIO.js";
import {
    ActionSchemaSementicMap,
    EmbeddingCache,
} from "../../translation/actionSchemaSemanticMap.js";
import { ActionSchemaFileCache } from "../../translation/actionSchemaFileCache.js";
import { ActionSchemaFile } from "action-schema";
import path from "path";
import { callEnsureError } from "../../utils/exceptions.js";

const debug = registerDebug("typeagent:dispatcher:agents");
const debugError = registerDebug("typeagent:dispatcher:agents:error");

type AppAgentRecord = {
    name: string;
    provider: AppAgentProvider;
    schemas: Set<string>;
    actions: Set<string>;
    commands: boolean;
    hasSchemas: boolean;
    manifest: AppAgentManifest;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
};

export type AppAgentState = {
    schemas: Record<string, boolean> | undefined;
    actions: Record<string, boolean> | undefined;
    commands: Record<string, boolean> | undefined;
};

export type AppAgentStateOptions = DeepPartialUndefinedAndNull<AppAgentState>;

// For force, if the option kind is null or the app agent value is null or missing, default to false.
// For overrides, if the options kind or app agent value is null, use the agent default.
// If it is missing, then either use the default value based on the 'useDefault' parameter, or the current value.
function getEffectiveValue(
    force: AppAgentStateOptions | undefined,
    overrides: AppAgentStateOptions | undefined,
    kind: keyof AppAgentState,
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

function computeStateChange(
    force: AppAgentStateOptions | undefined,
    overrides: AppAgentStateOptions | undefined,
    kind: keyof AppAgentState,
    name: string,
    useDefault: boolean,
    defaultEnabled: boolean,
    currentEnabled: boolean,
    failed: [string, boolean, Error][],
) {
    const alwaysEnabled = alwaysEnabledAgents[kind].includes(name);
    const effectiveEnabled = getEffectiveValue(
        force,
        overrides,
        kind,
        name,
        useDefault,
        defaultEnabled,
        currentEnabled,
    );
    if (alwaysEnabled && !effectiveEnabled) {
        // error message is user explicitly say false. (instead of using "null")
        if (
            force?.[kind]?.[name] === false ||
            overrides?.[kind]?.[name] === false
        ) {
            failed.push([
                name,
                effectiveEnabled,
                new Error(`Cannot disable ${kind} for '${name}'`),
            ]);
        }
    }
    const enable = alwaysEnabled || effectiveEnabled;
    if (enable !== currentEnabled) {
        return enable;
    }
    return undefined;
}

export type SetStateResult = {
    changed: {
        schemas: [string, boolean][];
        actions: [string, boolean][];
        commands: [string, boolean][];
    };
    failed: {
        actions: [string, boolean, Error][];
        commands: [string, boolean, Error][];
    };
};

export const alwaysEnabledAgents = {
    schemas: [DispatcherName],
    actions: [DispatcherName],
    commands: ["system"],
};

export class AppAgentManager implements ActionConfigProvider {
    private readonly agents = new Map<string, AppAgentRecord>();
    private readonly actionConfigs = new Map<string, ActionConfig>();
    private readonly injectedSchemaForActionName = new Map<string, string>();
    private readonly emojis: Record<string, string> = {};
    private readonly transientAgents: Record<string, boolean | undefined> = {};
    private readonly actionSementicMap?: ActionSchemaSementicMap;
    private readonly actionSchemaFileCache;

    public constructor(sessionDirPath: string | undefined) {
        this.actionSchemaFileCache = new ActionSchemaFileCache(
            sessionDirPath
                ? path.join(sessionDirPath, "actionSchemaFileCache.json")
                : undefined,
        );

        try {
            this.actionSementicMap = new ActionSchemaSementicMap();
        } catch (e) {
            if (process.env.NODE_ENV !== "test") {
                console.log("Failed to create action semantic map", e);
            }
        }
    }
    public getAppAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    public getAppAgentDescription(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.manifest.description;
    }

    public isSchemaEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.schemas.has(schemaName);
    }

    public isSchemaActive(schemaName: string) {
        return (
            this.isSchemaEnabled(schemaName) &&
            this.transientAgents[schemaName] !== false
        );
    }

    public getActiveSchemas() {
        return this.getSchemaNames().filter((name) =>
            this.isSchemaActive(name),
        );
    }

    public isActionActive(schemaName: string) {
        return (
            this.isActionEnabled(schemaName) &&
            this.transientAgents[schemaName] !== false
        );
    }

    public isActionEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.actions.has(schemaName);
    }

    public isCommandEnabled(appAgentName: string) {
        const record = this.agents.get(appAgentName);
        return record !== undefined
            ? record.commands && record.appAgent?.executeCommand !== undefined
            : false;
    }

    // Return undefined if we don't know because the agent isn't loaded yet.
    // Return null if the agent doesn't support commands.
    public getCommandEnabledState(appAgentName: string) {
        const record = this.agents.get(appAgentName);
        return record !== undefined && record.appAgent !== undefined
            ? record.appAgent.executeCommand !== undefined
                ? record.commands
                : null
            : undefined;
    }

    public getEmojis(): Readonly<Record<string, string>> {
        return this.emojis;
    }

    public async semanticSearchActionSchema(
        request: string,
        maxMatches: number = 1,
    ) {
        return this.actionSementicMap?.nearestNeighbors(
            request,
            this,
            maxMatches,
        );
    }

    public async addProvider(
        provider: AppAgentProvider,
        actionEmbeddingCache?: EmbeddingCache,
    ) {
        const semanticMapP: Promise<void>[] = [];
        for (const name of provider.getAppAgentNames()) {
            // TODO: detect duplicate names
            const manifest = await provider.getAppAgentManifest(name);
            this.emojis[name] = manifest.emojiChar;

            // TODO: detect duplicate names
            const actionConfigs = convertToActionConfig(name, manifest);

            const entries = Object.entries(actionConfigs);
            for (const [name, config] of entries) {
                debug(`Adding action config: ${name}`);
                this.actionConfigs.set(name, config);
                this.emojis[name] = config.emojiChar;

                const actionSchemaFile =
                    this.actionSchemaFileCache.getActionSchemaFile(config);

                if (this.actionSementicMap) {
                    semanticMapP.push(
                        this.actionSementicMap.addActionSchemaFile(
                            config,
                            actionSchemaFile,
                            actionEmbeddingCache,
                        ),
                    );
                }

                if (config.transient) {
                    this.transientAgents[name] = false;
                }
                if (config.injected) {
                    for (const actionName of actionSchemaFile.actionSchemas.keys()) {
                        this.injectedSchemaForActionName.set(actionName, name);
                    }
                }
            }

            const record: AppAgentRecord = {
                name,
                provider,
                actions: new Set(),
                schemas: new Set(),
                commands: false,
                hasSchemas: entries.length > 0,
                manifest,
            };

            this.agents.set(name, record);
        }
        debug("Waiting for action embeddings");
        await Promise.all(semanticMapP);
        debug("Finish action embeddings");
    }

    public getActionEmbeddings() {
        return this.actionSementicMap?.embeddings();
    }
    public tryGetActionConfig(mayBeSchemaName: string) {
        return this.actionConfigs.get(mayBeSchemaName);
    }
    public getActionConfig(schemaName: string) {
        const config = this.tryGetActionConfig(schemaName);
        if (config === undefined) {
            throw new Error(`Unknown schema name: ${schemaName}`);
        }
        return config;
    }

    public getSchemaNames() {
        return Array.from(this.actionConfigs.keys());
    }
    public getActionConfigs() {
        return Array.from(this.actionConfigs.entries());
    }

    public getInjectedSchemaForActionName(actionName: string) {
        return this.injectedSchemaForActionName.get(actionName);
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
        const changedSchemas: [string, boolean][] = [];
        const failedSchemas: [string, boolean, Error][] = [];
        const changedActions: [string, boolean][] = [];
        const failedActions: [string, boolean, Error][] = [];
        const changedCommands: [string, boolean][] = [];
        const failedCommands: [string, boolean, Error][] = [];

        const p: Promise<void>[] = [];
        for (const [name, config] of this.actionConfigs) {
            const record = this.getRecord(getAppAgentName(name));

            const enableSchema = computeStateChange(
                force,
                overrides,
                "schemas",
                name,
                useDefault,
                config.translationDefaultEnabled,
                record.schemas.has(name),
                failedSchemas,
            );
            if (enableSchema !== undefined) {
                if (enableSchema) {
                    record.schemas.add(name);
                    changedSchemas.push([name, enableSchema]);
                    debug(`Schema enabled ${name}`);
                } else {
                    record.schemas.delete(name);
                    changedSchemas.push([name, enableSchema]);
                    debug(`Schema disnabled ${name}`);
                }
            }

            const enableAction = computeStateChange(
                force,
                overrides,
                "actions",
                name,
                useDefault,
                config.actionDefaultEnabled,
                record.actions.has(name),
                failedActions,
            );
            if (enableAction !== undefined) {
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
            const enableCommands = computeStateChange(
                force,
                overrides,
                "commands",
                record.name,
                useDefault,
                record.manifest.commandDefaultEnabled ??
                    record.manifest.defaultEnabled ??
                    true,
                record.commands,
                failedCommands,
            );

            if (enableCommands !== undefined) {
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
                                debug(`Command enabled ${record.name}`);
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
                    debug(`Command disabled ${record.name}`);
                    record.commands = false;
                    changedCommands.push([record.name, enableCommands]);
                    await this.checkCloseSessionContext(record);
                }
            }
        }

        await Promise.all(p);
        return {
            changed: {
                schemas: changedSchemas,
                actions: changedActions,
                commands: changedCommands,
            },
            failed: {
                actions: failedActions,
                commands: failedCommands,
            },
        };
    }

    public getTransientState(schemaName: string) {
        return this.transientAgents[schemaName];
    }

    public toggleTransient(schemaName: string, enable: boolean) {
        if (this.transientAgents[schemaName] === undefined) {
            throw new Error(`Transient sub agent not found: ${schemaName}`);
        }
        debug(
            `Toggle transient agent '${schemaName}' to ${enable ? "enabled" : "disabled"}`,
        );
        this.transientAgents[schemaName] = enable;
    }
    public async close() {
        for (const record of this.agents.values()) {
            record.actions.clear();
            record.commands = false;
            await this.closeSessionContext(record);
            if (record.appAgent !== undefined) {
                record.provider.unloadAppAgent(record.name);
            }
            record.appAgent = undefined;
        }
    }

    private async updateAction(
        schemaName: string,
        record: AppAgentRecord,
        enable: boolean,
        context: CommandHandlerContext,
    ) {
        if (enable) {
            if (record.actions.has(schemaName)) {
                return;
            }

            record.actions.add(schemaName);
            try {
                const sessionContext = await this.ensureSessionContext(
                    record,
                    context,
                );
                await callEnsureError(() =>
                    record.appAgent!.updateAgentContext?.(
                        enable,
                        sessionContext,
                        schemaName,
                    ),
                );
            } catch (e) {
                // Rollback if there is a exception
                record.actions.delete(schemaName);
                throw e;
            }
            debug(`Action enabled ${schemaName}`);
        } else {
            if (!record.actions.has(schemaName)) {
                return;
            }
            record.actions.delete(schemaName);
            const sessionContext = await record.sessionContextP!;
            try {
                await callEnsureError(() =>
                    record.appAgent!.updateAgentContext?.(
                        enable,
                        sessionContext,
                        schemaName,
                    ),
                );
            } finally {
                // Assume that it is disabled even when there is an exception
                debug(`Action disabled ${schemaName}`);
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
        const agentContext = await callEnsureError(() =>
            appAgent.initializeAgentContext?.(),
        );
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

    public getActionSchemaFile(schemaName: string) {
        const config = this.tryGetActionConfig(schemaName);
        return config ? this.getActionSchemaFileForConfig(config) : undefined;
    }

    public getActionSchemaFileForConfig(
        config: ActionConfig,
    ): ActionSchemaFile {
        return this.actionSchemaFileCache.getActionSchemaFile(config);
    }
}
