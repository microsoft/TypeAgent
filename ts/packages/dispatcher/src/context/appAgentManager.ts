// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    AppAgentManifest,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    convertToActionConfig,
    ActionConfig,
} from "../translation/actionConfig.js";
import {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../translation/actionConfigProvider.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
import { createSessionContext } from "../execute/actionHandlers.js";
import { AppAgentProvider } from "../agentProvider/agentProvider.js";
import registerDebug from "debug";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import {
    ActionSchemaSemanticMap,
    EmbeddingCache,
} from "../translation/actionSchemaSemanticMap.js";
import { ActionSchemaFileCache } from "../translation/actionSchemaFileCache.js";
import path from "path";
import { callEnsureError } from "../utils/exceptions.js";
import {
    AppAgentStateConfig,
    appAgentStateKeys,
} from "./appAgentStateConfig.js";

const debug = registerDebug("typeagent:dispatcher:agents");
const debugError = registerDebug("typeagent:dispatcher:agents:error");
const debugLoad = registerDebug("typeagent:dispatcher:agents:load");

type AppAgentRecord = {
    name: string;
    provider?: AppAgentProvider | undefined;
    schemas: Set<string>;
    actions: Set<string>;
    commands: boolean;
    manifest: AppAgentManifest;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
    schemaErrors: Map<string, Error>;
    port?: number | undefined;
};

export type AppAgentStateSettings = Partial<AppAgentStateConfig>;

function computeStateChange(
    settings: AppAgentStateSettings | undefined,
    kind: keyof AppAgentStateConfig,
    name: string,
    defaultEnabled: boolean,
    failed: [string, boolean, Error][],
) {
    const alwaysEnabled = alwaysEnabledAgents[kind].includes(name);
    const effectiveEnabled = settings?.[kind]?.[name] ?? defaultEnabled;
    if (alwaysEnabled && !effectiveEnabled) {
        failed.push([
            name,
            effectiveEnabled,
            new Error(`Cannot disable ${kind} for '${name}'`),
        ]);
    }
    return alwaysEnabled || effectiveEnabled;
}

export type SetStateResult = {
    changed: {
        schemas: [string, boolean][];
        actions: [string, boolean][];
        commands: [string, boolean][];
    };
    failed: {
        schemas: [string, boolean, Error][];
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
    private readonly emojis: Record<string, string> = {};
    private readonly transientAgents: Record<string, boolean | undefined> = {};
    private readonly actionSemanticMap?: ActionSchemaSemanticMap;
    private readonly actionSchemaFileCache: ActionSchemaFileCache;
    private nextPortIndex = 0;
    public constructor(
        cacheDir: string | undefined,
        private readonly portBase: number,
        private readonly allowSharedLocalView?: string[],
        private readonly agentInitOptions?: Record<string, unknown>,
    ) {
        this.actionSchemaFileCache = new ActionSchemaFileCache(
            cacheDir
                ? path.join(cacheDir, "actionSchemaFileCache.json")
                : undefined,
        );

        try {
            this.actionSemanticMap = new ActionSchemaSemanticMap();
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
    public getLocalHostPort(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.port;
    }

    public getSharedLocalHostPort(requester: string, target: string) {
        const record = this.agents.get(target);

        // Denied access if it is not a valid agent name to avoid leaking information
        // about whether agent exists or not.
        if (
            record === undefined ||
            (!this.allowSharedLocalView?.includes(requester) && // host declare allowed agents to share
                record.manifest.sharedLocalView?.includes(requester) !== true) // agent declared allowed agents to share.
        ) {
            throw new Error(
                `Agent '${requester}' is not allowed to access '${target}' local view.`,
            );
        }

        if (record.port === undefined) {
            throw new Error(`Local view not available for agent '${target}'.`);
        }

        if (record.appAgent === undefined) {
            throw new Error(
                `Agent '${target}' is not initialized. Local view not available.`,
            );
        }
        return record.port;
    }

    public isAppAgentName(appAgentName: string) {
        return this.agents.get(appAgentName) !== undefined;
    }

    // Throws if schemaName is invalid.
    public isSchemaEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.schemas.has(schemaName);
    }

    // Throws if schemaName is invalid.
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

    // Throws if schemaName is invalid.
    public isActionActive(schemaName: string) {
        return (
            this.isActionEnabled(schemaName) &&
            this.transientAgents[schemaName] !== false
        );
    }

    // Throws if schemaName is invalid.
    public isActionEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.actions.has(schemaName);
    }

    // Throws if appAgentName is invalid.
    public isCommandEnabled(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.commands && record.appAgent?.executeCommand !== undefined;
    }

    // Return undefined if we don't know because the agent isn't loaded yet.
    // Return null if the agent doesn't support commands.
    // Throws if appAgentName is invalid.
    public getCommandEnabledState(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.appAgent !== undefined
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
        filter: (schemaName: string) => boolean = (schemaName) =>
            this.isSchemaActive(schemaName),
    ) {
        return this.actionSemanticMap?.nearestNeighbors(
            request,
            maxMatches,
            filter,
        );
    }

    public async addProvider(
        provider: AppAgentProvider,
        actionEmbeddingCache?: EmbeddingCache,
    ) {
        const semanticMapP: Promise<void>[] = [];
        for (const name of provider.getAppAgentNames()) {
            const manifest = await provider.getAppAgentManifest(name);
            this.addAgentManifest(
                name,
                manifest,
                semanticMapP,
                provider,
                actionEmbeddingCache,
            );
        }
        debug("Waiting for action embeddings");
        await Promise.all(semanticMapP);
        debug("Finish action embeddings");
    }

    private addAgentManifest(
        appAgentName: string,
        manifest: AppAgentManifest,
        semanticMapP: Promise<void>[],
        provider?: AppAgentProvider,
        actionEmbeddingCache?: EmbeddingCache,
    ) {
        if (this.isAppAgentName(appAgentName)) {
            throw new Error(`Conflicting app agents name '${appAgentName}'`);
        }
        const actionConfigs = convertToActionConfig(appAgentName, manifest);

        const entries = Object.entries(actionConfigs);
        const schemaErrors = new Map<string, Error>();

        for (const [schemaName, config] of entries) {
            debug(`Adding action config: ${schemaName}`);
            this.actionConfigs.set(schemaName, config);
            this.emojis[schemaName] = config.emojiChar;
            if (config.transient) {
                this.transientAgents[schemaName] = false;
            }
            try {
                const actionSchemaFile =
                    this.actionSchemaFileCache.getActionSchemaFile(config);

                if (this.actionSemanticMap) {
                    semanticMapP.push(
                        this.actionSemanticMap.addActionSchemaFile(
                            config,
                            actionSchemaFile,
                            actionEmbeddingCache,
                        ),
                    );
                }
            } catch (e: any) {
                schemaErrors.set(schemaName, e);
            }
        }

        this.emojis[appAgentName] = manifest.emojiChar;

        const port = manifest.localView
            ? this.portBase + this.nextPortIndex++
            : undefined;

        if (port !== undefined) {
            debug(`Port ${port} assigned to ${appAgentName}`);
        }

        const record: AppAgentRecord = {
            name: appAgentName,
            provider,
            actions: new Set(),
            schemas: new Set(),
            schemaErrors,
            commands: false,
            manifest,
            port,
        };

        this.agents.set(appAgentName, record);
        return record;
    }

    public async addDynamicAgent(
        appAgentName: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
    ) {
        if (this.agents.has(appAgentName)) {
            throw new Error(`App agent '${appAgentName}' already exists`);
        }

        // REVIEW: action embedding is not cached.
        const semanticMapP: Promise<void>[] = [];
        const record = this.addAgentManifest(
            appAgentName,
            manifest,
            semanticMapP,
        );
        record.appAgent = appAgent;

        debug("Waiting for action embeddings");
        await Promise.all(semanticMapP);
        debug("Finish action embeddings");
    }

    private cleanupAgent(appAgentName: string) {
        delete this.emojis[appAgentName];
        for (const [schemaName, config] of this.actionConfigs) {
            if (getAppAgentName(schemaName) !== appAgentName) {
                continue;
            }
            delete this.emojis[schemaName];
            this.actionConfigs.delete(schemaName);
            this.actionSchemaFileCache.unloadActionSchemaFile(schemaName);
            this.actionSemanticMap?.removeActionSchemaFile(schemaName);
            if (config.transient) {
                delete this.transientAgents[schemaName];
            }
        }
    }

    public async removeAgent(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        this.agents.delete(appAgentName);
        this.cleanupAgent(appAgentName);

        await this.closeSessionContext(record);
        if (record.appAgent !== undefined) {
            await record.provider?.unloadAppAgent(record.name);
        }
    }

    public getActionEmbeddings() {
        return this.actionSemanticMap?.embeddings();
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
        return Array.from(this.actionConfigs.values());
    }

    public getAppAgent(appAgentName: string): AppAgent {
        const record = this.getRecord(appAgentName);
        if (record.appAgent === undefined) {
            throw new Error(`App agent' ${appAgentName}' is not initialized`);
        }
        return record.appAgent;
    }

    public getSessionContext(appAgentName: string): SessionContext {
        const record = this.getRecord(appAgentName);
        if (record.sessionContext === undefined) {
            throw new Error(
                `Session context for '${appAgentName}' is not initialized`,
            );
        }
        return record.sessionContext;
    }

    public async setState(
        context: CommandHandlerContext,
        settings?: AppAgentStateSettings,
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
                settings,
                "schemas",
                name,
                config.schemaDefaultEnabled,
                failedSchemas,
            );
            if (enableSchema !== record.schemas.has(name)) {
                if (enableSchema) {
                    const e = record.schemaErrors.get(name);
                    if (e !== undefined) {
                        failedSchemas.push([name, enableSchema, e]);
                        debugError(
                            `Schema '${name}' is not enabled because of error: ${e.message}`,
                        );
                    } else {
                        record.schemas.add(name);
                        changedSchemas.push([name, enableSchema]);
                        debug(`Schema enabled ${name}`);
                    }
                } else {
                    record.schemas.delete(name);
                    changedSchemas.push([name, enableSchema]);
                    debug(`Schema disabled ${name}`);
                }
            }

            const enableAction = computeStateChange(
                settings,
                "actions",
                name,
                config.actionDefaultEnabled,
                failedActions,
            );
            if (enableAction !== record.actions.has(name)) {
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
                settings,
                "commands",
                record.name,
                record.manifest.commandDefaultEnabled ??
                    record.manifest.defaultEnabled ??
                    true,
                failedCommands,
            );

            if (enableCommands !== record.commands) {
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
                schemas: failedSchemas,
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
        const closeP: Promise<void>[] = [];
        for (const record of this.agents.values()) {
            closeP.push(
                (async () => {
                    record.actions.clear();
                    record.commands = false;
                    await this.closeSessionContext(record);
                    if (record.appAgent !== undefined) {
                        await record.provider?.unloadAppAgent(record.name);
                    }
                    record.appAgent = undefined;
                })(),
            );
        }
        await Promise.all(closeP);
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
        let agentContext: unknown | undefined;
        if (appAgent.initializeAgentContext !== undefined) {
            const options = this.agentInitOptions?.[record.name];
            let settings: AppAgentInitSettings | undefined =
                record.port !== undefined
                    ? {
                          localHostPort: record.port,
                      }
                    : undefined;

            if (options !== undefined) {
                if (settings === undefined) {
                    settings = {};
                }
                settings.options = options;
            }
            agentContext = await callEnsureError(() =>
                appAgent.initializeAgentContext!(settings),
            );
        }
        record.sessionContext = createSessionContext(
            record.name,
            agentContext,
            context,
            record.name === "browser", // TODO: Make this not hard coded
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
            if (record.provider === undefined) {
                throw new Error(
                    `Internal error: no provider to load the app agent: ${record.name}`,
                );
            }
            const start = performance.now();
            record.appAgent = await record.provider.loadAppAgent(record.name);
            debugLoad(
                `App agent loaded: ${record.name} (${(performance.now() - start).toFixed(0)}ms)`,
            );
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

    public tryGetActionSchemaFile(schemaName: string) {
        const config = this.tryGetActionConfig(schemaName);
        if (config === undefined) {
            return undefined;
        }
        return this.getActionSchemaFileForConfig(config);
    }

    public getActionSchemaFileForConfig(
        config: ActionConfig,
    ): ActionSchemaFile {
        return this.actionSchemaFileCache.getActionSchemaFile(config);
    }

    public setTraceNamespaces(namespaces: string) {
        const providers = new Set<AppAgentProvider>();
        for (const { provider } of this.agents.values()) {
            if (provider === undefined || providers.has(provider)) {
                continue;
            }
            provider.setTraceNamespaces?.(namespaces);
            providers.add(provider);
        }
    }
}

export type AppAgentStateInitSettings =
    | string[]
    | boolean
    | undefined
    | {
          schemas?: string[] | boolean | undefined;
          actions?: string[] | boolean | undefined;
          commands?: string[] | boolean | undefined;
      };

export function getAppAgentStateSettings(
    settings: AppAgentStateInitSettings,
    agents: AppAgentManager,
): AppAgentStateSettings | undefined {
    if (settings === undefined) {
        return undefined;
    }
    const result: AppAgentStateSettings = {};
    if (typeof settings === "boolean" || Array.isArray(settings)) {
        for (const key of appAgentStateKeys) {
            const names =
                key === "commands"
                    ? agents.getAppAgentNames()
                    : agents.getSchemaNames();
            const entries = names.map((name) => [
                name,
                typeof settings === "boolean"
                    ? settings
                    : settings.includes(getAppAgentName(name)),
            ]);
            const state = Object.fromEntries(entries);
            for (const name of alwaysEnabledAgents[key]) {
                if (state[name] === false) {
                    state[name] = true;
                }
            }
            result[key] = state;
        }
        return result;
    }
    for (const key of appAgentStateKeys) {
        const state = settings[key];
        if (state === undefined) {
            continue;
        }
        const alwaysEnabled = alwaysEnabledAgents[key];
        const names =
            key === "commands"
                ? agents.getAppAgentNames()
                : agents.getSchemaNames();
        const entries = names.map((name) => [
            name,
            alwaysEnabled.includes(name)
                ? true
                : typeof state === "boolean"
                  ? state
                  : state.includes(name),
        ]);
        result[key] = Object.fromEntries(entries);
    }
    return Object.keys(result).length === 0 ? undefined : result;
}
