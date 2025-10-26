// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentEvent,
    AppAgent,
    AppAgentManifest,
    SessionContext,
    DisplayContent,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { getStorage } from "./storageImpl.js";
import { IndexData } from "image-memory";
import { IndexManager } from "../context/indexManager.js";
import registerDebug from "debug";

const debugLog = registerDebug("typeagent:dispatcher:notify");

// Only browser and dispatcher agents can send rich notifications
const ALLOWED_RICH_NOTIFY_AGENTS = new Set(["browser", "dispatcher"]);

export function createSessionContext<T = unknown>(
    name: string,
    agentContext: T,
    context: CommandHandlerContext,
    allowDynamicAgent: boolean,
): SessionContext<T> {
    const sessionDirPath = context.session.getSessionDirPath();
    const storage = sessionDirPath
        ? getStorage(name, sessionDirPath)
        : undefined;
    const instanceStorage = context.persistDir
        ? getStorage(name, context.persistDir)
        : undefined;
    const dynamicAgentNames = new Set<string>();
    const addDynamicAgent = allowDynamicAgent
        ? (agentName: string, manifest: AppAgentManifest, appAgent: AppAgent) =>
              // acquire the lock to prevent change the state while we are processing a command or removing dynamic agent.
              // WARNING: deadlock if this is call because we are processing a request
              context.commandLock(async () => {
                  await context.agents.addDynamicAgent(
                      agentName,
                      manifest,
                      appAgent,
                  );
                  dynamicAgentNames.add(agentName);
                  // Update the enable state to reflect the new agent
                  context.agents.setState(context, context.session.getConfig());
              })
        : () => {
              throw new Error("Permission denied: cannot add dynamic agent");
          };

    const removeDynamicAgent = allowDynamicAgent
        ? (agentName: string) =>
              // acquire the lock to prevent change the state while we are processing a command or adding dynamic agent.
              // WARNING: deadlock if this is called while we are processing a request
              context.commandLock(async () => {
                  if (!dynamicAgentNames.delete(agentName)) {
                      throw new Error(
                          `Permission denied: dynamic agent '${agentName}' not added by this agent`,
                      );
                  }
                  return context.agents.removeAgent(
                      agentName,
                      context.agentCache.grammarStore,
                  );
              })
        : () => {
              throw new Error("Permission denied: cannot remove dynamic agent");
          };

    const forceCleanupDynamicAgent = allowDynamicAgent
        ? (agentName: string) =>
              context.commandLock(async () => {
                  dynamicAgentNames.delete(agentName);
                  return context.agents.forceCleanupAgent(
                      agentName,
                      context.agentCache.grammarStore,
                  );
              })
        : () => {
              throw new Error(
                  "Permission denied: cannot force cleanup dynamic agent",
              );
          };

    const sessionContext: SessionContext<T> = {
        get agentContext() {
            return agentContext;
        },
        get sessionStorage() {
            return storage;
        },
        get instanceStorage() {
            return instanceStorage;
        },
        notify(
            event: AppAgentEvent,
            message: string | DisplayContent,
            eventSetId?: string,
        ) {
            // Check if agent can send rich notifications (DisplayContent objects)
            if (
                typeof message === "object" &&
                !ALLOWED_RICH_NOTIFY_AGENTS.has(name)
            ) {
                debugLog(
                    `Agent ${name} not allowed to send rich notifications`,
                );
                return;
            }

            // Use eventSetId if provided, otherwise use context.requestId
            // If no eventSetId and no context.requestId, generate a unique ID for standalone notifications
            let requestId: string;
            if (eventSetId) {
                requestId = `agent-eventset-${eventSetId}`;
            } else if (context.requestId) {
                requestId = context.requestId;
            } else {
                // Fallback for notifications without a request context (e.g., background events)
                requestId = `agent-${name}-${Date.now()}`;
            }

            context.clientIO.notify(event, requestId, message, name);
        },
        async toggleTransientAgent(subAgentName: string, enable: boolean) {
            if (!subAgentName.startsWith(`${name}.`)) {
                throw new Error(`Invalid sub agent name: ${subAgentName}`);
            }
            const state = context.agents.getTransientState(subAgentName);
            if (state === undefined) {
                throw new Error(
                    `Transient sub agent not found: ${subAgentName}`,
                );
            }

            if (state === enable) {
                return;
            }

            // acquire the lock to prevent change the state while we are processing a command.
            // WARNING: deadlock if this is call because we are processing a request
            return context.commandLock(async () => {
                context.agents.toggleTransient(subAgentName, enable);
                // Changing active schemas, we need to clear the cache.
                context.translatorCache.clear();
                if (enable) {
                    // REVIEW: is switch current translator the right behavior?
                    context.lastActionSchemaName = subAgentName;
                } else if (context.lastActionSchemaName === subAgentName) {
                    context.lastActionSchemaName = name;
                }
            });
        },
        addDynamicAgent,
        removeDynamicAgent,
        forceCleanupDynamicAgent,
        getSharedLocalHostPort: async (agentName: string) => {
            const localHostPort = await context.agents.getSharedLocalHostPort(
                name,
                agentName,
            );
            if (localHostPort === undefined) {
                throw new Error(
                    `Agent '${agentName}' does not have a shared local host port.`,
                );
            }
            return localHostPort;
        },
        indexes(type: string): Promise<any[]> {
            return new Promise<IndexData[]>((resolve, reject) => {
                const iidx: IndexData[] =
                    IndexManager.getInstance().indexes.filter((value) => {
                        return type === "all" || value.source === type;
                    });

                resolve(iidx);
            });
        },
        popupQuestion(
            message: string,
            choices: string[] = ["Yes", "No"], // default choices
            defaultId?: number,
        ): Promise<number> {
            return context.clientIO.popupQuestion(
                message,
                choices,
                defaultId,
                name,
            );
        },
    };

    (sessionContext as any).conversationManager = context.conversationManager;
    return sessionContext;
}
