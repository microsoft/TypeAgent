// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    TopLevelTranslatorConfig,
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
import { getTranslatorActionInfo } from "../../translation/actionInfo.js";

const debug = registerDebug("typeagent:agents");

type AppAgentRecord = {
    name: string;
    provider: AppAgentProvider;
    enabled: Set<string>;
    config: TopLevelTranslatorConfig;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
};

export class AppAgentManager implements TranslatorConfigProvider {
    private readonly agents = new Map<string, AppAgentRecord>();
    private readonly translatorConfigs = new Map<string, TranslatorConfig>();
    private readonly injectedTranslatorForActionName = new Map<
        string,
        string
    >();

    public isTranslator(translatorName: string) {
        return this.translatorConfigs.has(translatorName);
    }

    public async addProvider(provider: AppAgentProvider) {
        for (const name of provider.getAppAgentNames()) {
            // TODO: detect duplicate names
            const config = await provider.getAppAgentConfig(name);
            this.agents.set(name, {
                name,
                provider,
                enabled: new Set(),
                config,
            });

            // TODO: detect duplicate names
            const translatorConfigs = convertToTranslatorConfigs(name, config);
            const entries = Object.entries(translatorConfigs);
            for (const [name, config] of entries) {
                this.translatorConfigs.set(name, config);
                if (config.injected) {
                    for (const info of getTranslatorActionInfo(config, name)) {
                        this.injectedTranslatorForActionName.set(
                            info.name,
                            name,
                        );
                    }
                }
            }
        }
    }

    public getTranslatorConfig(translatorName: string) {
        const config = this.translatorConfigs.get(translatorName);
        if (config === undefined) {
            throw new Error(`Unknown translator: ${translatorName}`);
        }
        return config;
    }

    public getTranslatorConfigs() {
        return Array.from(this.translatorConfigs.entries());
    }

    public getInjectedTranslatorForActionName(actionName: string) {
        return this.injectedTranslatorForActionName.get(actionName);
    }

    public getAppAgentConfigs() {
        return Array.from(this.agents.entries()).map(
            ([name, record]) => [name, record.config] as const,
        );
    }

    public getAppAgent(appAgentName: string): AppAgent {
        const record = this.getRecord(appAgentName);
        if (record.appAgent === undefined) {
            throw new Error("App agent is not initialized");
        }
        return record.appAgent;
    }

    public getSessionContext(appAgentName: string): SessionContext {
        const record = this.getRecord(appAgentName);
        if (record.sessionContext === undefined) {
            throw new Error("Session context is not initialized");
        }
        return record.sessionContext;
    }

    public async update(
        translatorName: string,
        enable: boolean,
        context: CommandHandlerContext,
    ) {
        const appAgentName = getAppAgentName(translatorName);
        // For update, it's only if the agent does not exist.
        const record = this.agents.get(appAgentName);
        if (record === undefined) {
            return;
        }
        if (enable) {
            if (record.enabled.has(translatorName)) {
                return;
            }

            record.enabled.add(translatorName);
            const sessionContext = await this.ensureSessionContext(
                record,
                context,
            );
            await record.appAgent!.updateAgentContext?.(
                enable,
                sessionContext,
                translatorName,
            );
            debug(`Enabled ${translatorName}`);
        } else {
            if (!record.enabled.has(translatorName)) {
                return;
            }
            record.enabled.delete(translatorName);
            const sessionContext = await record.sessionContextP!;
            await record.appAgent!.updateAgentContext?.(
                enable,
                sessionContext,
                translatorName,
            );
            debug(`Disabled ${translatorName}`);
            if (record.enabled.size === 0) {
                await this.closeSessionContext(record);
            }
        }
    }

    public async close() {
        for (const record of this.agents.values()) {
            record.enabled.clear();
            await this.closeSessionContext(record);
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

    private async closeSessionContext(record: AppAgentRecord) {
        if (record.sessionContextP !== undefined) {
            const sessionContext = await record.sessionContextP;
            await record.appAgent!.closeAgentContext?.(sessionContext);
            record.sessionContext = undefined;
            record.sessionContextP = undefined;
            // TODO: close the unload agent as well?
            debug(`Session context closed for ${record.name}`);
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
