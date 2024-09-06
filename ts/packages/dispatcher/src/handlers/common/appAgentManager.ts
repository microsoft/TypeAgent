// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    TopLevelTranslatorConfig,
} from "@typeagent/agent-sdk";
import { getDispatcherConfig } from "../../utils/config.js";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import { getAppAgentName } from "../../translation/agentTranslators.js";
import { getModuleAgent } from "../../agent/agentConfig.js";
import { loadInlineAgent } from "../../agent/inlineAgentHandlers.js";
import { createSessionContext } from "../../action/actionHandlers.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:agents");

type AppAgentRecord = {
    name: string;
    type: "module" | "inline";
    enabled: Set<string>;
    config: TopLevelTranslatorConfig;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
};

export class AppAgentManager {
    private readonly agents: Map<string, AppAgentRecord>;
    constructor(configs: Map<string, TopLevelTranslatorConfig>) {
        this.agents = new Map<string, AppAgentRecord>(
            Array.from(configs.entries()).map(([name, config]) => [
                name,
                {
                    name,
                    type: getDispatcherConfig().agents[name].type ?? "inline",
                    config,
                    enabled: new Set(),
                },
            ]),
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
        const record = this.getRecord(appAgentName);
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
        const appAgent = await this.ensureAppAgent(record, context);
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

    private async ensureAppAgent(
        record: AppAgentRecord,
        context: CommandHandlerContext,
    ) {
        if (record.appAgent === undefined) {
            record.appAgent =
                record.type === "module"
                    ? await getModuleAgent(record.name)
                    : loadInlineAgent(record.name, context);
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
