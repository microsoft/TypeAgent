// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocket } from "common-utils/ws";
import { WebSocket } from "ws";
import {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentEvent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { Crossword } from "./crossword/schema/pageSchema.mjs";
import {
    getBoardSchema,
    handleCrosswordAction,
} from "./crossword/actionHandler.mjs";

import { BrowserConnector } from "./browserConnector.mjs";
import { handleCommerceAction } from "./commerce/actionHandler.mjs";
import { TabTitleIndex, createTabTitleIndex } from "./tabTitleIndex.mjs";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

// import { handleInstacartAction } from "./instacart/actionHandler.mjs";
import { handleInstacartAction } from "./instacart/planHandler.mjs";

import {
    loadAllowDynamicAgentDomains,
    processWebAgentMessage,
    WebAgentChannels,
} from "./webTypeAgent.mjs";
import { isWebAgentMessage } from "../common/webAgentMessageTypes.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import { BrowserActions } from "./actionsSchema.mjs";
import { CrosswordActions } from "./crossword/schema/userActions.mjs";
import { InstacartActions } from "./instacart/schema/userActions.mjs";
import { ShoppingActions } from "./commerce/schema/userActions.mjs";
import { SchemaDiscoveryActions } from "./discovery/schema/discoveryActions.mjs";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeBrowserContext,
        updateAgentContext: updateBrowserContext,
        executeAction: executeBrowserAction,
        ...getCommandInterface(handlers),
    };
}

export type BrowserActionContext = {
    webSocket?: WebSocket | undefined;
    webAgentChannels?: WebAgentChannels | undefined;
    crossWordState?: Crossword | undefined;
    browserConnector?: BrowserConnector | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
};

async function initializeBrowserContext(): Promise<BrowserActionContext> {
    return {};
}

async function updateBrowserContext(
    enable: boolean,
    context: SessionContext<BrowserActionContext>,
    schemaName: string,
): Promise<void> {
    if (schemaName !== "browser") {
        // REVIEW: ignore sub-translator updates.
        return;
    }
    if (enable) {
        await loadAllowDynamicAgentDomains(context);
        if (!context.agentContext.tabTitleIndex) {
            context.agentContext.tabTitleIndex = createTabTitleIndex();
        }

        if (context.agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket("browser", "dispatcher");
        if (webSocket) {
            context.agentContext.webSocket = webSocket;
            context.agentContext.browserConnector = new BrowserConnector(
                context,
            );

            webSocket.onclose = (event: object) => {
                console.error("Browser webSocket connection closed.");
                context.agentContext.webSocket = undefined;
            };
            webSocket.addEventListener("message", async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text);
                if (isWebAgentMessage(data)) {
                    await processWebAgentMessage(data, context);
                    return;
                }

                if (data.error) {
                    console.error(data.error);
                    // TODO: Handle the case where no clients were found. Prompt the user
                    //       to launch inline browser or run automation in the headless browser.
                    return;
                }

                if (data.method) {
                    switch (data.method) {
                        case "enableSiteTranslator": {
                            const targetTranslator = data.params.translator;
                            if (targetTranslator == "browser.crossword") {
                                // initialize crossword state
                                sendSiteTranslatorStatus(
                                    targetTranslator,
                                    "initializing",
                                    context,
                                );
                                context.agentContext.crossWordState =
                                    await getBoardSchema(context);

                                sendSiteTranslatorStatus(
                                    targetTranslator,
                                    "initialized",
                                    context,
                                );

                                if (context.agentContext.crossWordState) {
                                    context.notify(
                                        AppAgentEvent.Info,
                                        "Crossword board initialized.",
                                    );
                                } else {
                                    context.notify(
                                        AppAgentEvent.Error,
                                        "Crossword board initialization failed.",
                                    );
                                }
                            }
                            await context.toggleTransientAgent(
                                targetTranslator,
                                true,
                            );
                            break;
                        }
                        case "disableSiteTranslator": {
                            const targetTranslator = data.params.translator;
                            await context.toggleTransientAgent(
                                targetTranslator,
                                false,
                            );
                            break;
                        }
                        case "addTabIdToIndex":
                        case "deleteTabIdFromIndex":
                        case "getTabIdFromIndex":
                        case "resetTabIdToIndex": {
                            await handleTabIndexActions(
                                {
                                    actionName: data.method,
                                    parameters: data.params,
                                },
                                context,
                                data.id,
                            );
                            break;
                        }

                        case "detectPageActions":
                        case "registerPageDynamicAgent":
                        case "getIntentFromRecording": {
                            const discoveryResult =
                                await handleSchemaDiscoveryAction(
                                    {
                                        actionName: data.method,
                                        parameters: data.params,
                                    },
                                    context,
                                );

                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: discoveryResult.data,
                                }),
                            );
                        }
                    }
                }
            });
        }
    } else {
        const webSocket = context.agentContext.webSocket;
        if (webSocket) {
            webSocket.onclose = null;
            webSocket.close();
        }

        context.agentContext.webSocket = undefined;

        // shut down service
        if (context.agentContext.browserProcess) {
            context.agentContext.browserProcess.kill();
        }
    }
}

async function executeBrowserAction(
    action:
        | TypeAgentAction<BrowserActions, "browser">
        | TypeAgentAction<CrosswordActions, "browser.crossword">
        | TypeAgentAction<ShoppingActions, "browser.commerce">
        | TypeAgentAction<InstacartActions, "browser.instacart">
        | TypeAgentAction<SchemaDiscoveryActions, "browser.actionDiscovery">,

    context: ActionContext<BrowserActionContext>,
) {
    const webSocketEndpoint = context.sessionContext.agentContext.webSocket;
    const connector = context.sessionContext.agentContext.browserConnector;
    if (webSocketEndpoint) {
        try {
            context.actionIO.setDisplay("Running remote action.");

            let schemaName = "browser";
            if (action.schemaName === "browser.crossword") {
                const crosswordResult = await handleCrosswordAction(
                    action,
                    context.sessionContext,
                );
                return createActionResult(crosswordResult);
            } else if (action.schemaName === "browser.commerce") {
                const commerceResult = await handleCommerceAction(
                    action,
                    context,
                );
                if (commerceResult !== undefined) {
                    if (commerceResult instanceof String) {
                        return createActionResult(
                            commerceResult as unknown as string,
                        );
                    } else {
                        return commerceResult as ActionResult;
                    }
                }
            } else if (action.schemaName === "browser.instacart") {
                const instacartResult = await handleInstacartAction(
                    action,
                    context.sessionContext,
                );

                return createActionResult(
                    instacartResult.displayText,
                    undefined,
                    instacartResult.entities,
                );

                // return createActionResult(instacartResult);
            } else if (action.schemaName === "browser.actionDiscovery") {
                const discoveryResult = await handleSchemaDiscoveryAction(
                    action,
                    context.sessionContext,
                );

                return createActionResult(discoveryResult.displayText);
            }

            await connector?.sendActionToBrowser(action, schemaName);
        } catch (ex: any) {
            if (ex instanceof Error) {
                console.error(ex);
            } else {
                console.error(JSON.stringify(ex));
            }

            throw new Error("Unable to contact browser backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}

function sendSiteTranslatorStatus(
    schemaName: string,
    status: string,
    context: SessionContext<BrowserActionContext>,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
    const callId = new Date().getTime().toString();

    if (webSocketEndpoint) {
        webSocketEndpoint.send(
            JSON.stringify({
                method: "browser/siteTranslatorStatus",
                id: callId,
                params: {
                    translator: schemaName,
                    status: status,
                },
            }),
        );
    }
}

async function handleTabIndexActions(
    action: any,
    context: SessionContext<BrowserActionContext>,
    requestId: string | undefined,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
    const tabTitleIndex = context.agentContext.tabTitleIndex;

    if (webSocketEndpoint && tabTitleIndex) {
        try {
            const actionName =
                action.actionName ?? action.fullActionName.split(".").at(-1);
            let responseBody;

            switch (actionName) {
                case "getTabIdFromIndex": {
                    const matchedTabs = await tabTitleIndex.search(
                        action.parameters.query,
                        1,
                    );
                    let foundId = -1;
                    if (matchedTabs && matchedTabs.length > 0) {
                        foundId = matchedTabs[0].item.value;
                    }
                    responseBody = foundId;
                    break;
                }
                case "addTabIdToIndex": {
                    await tabTitleIndex.addOrUpdate(
                        action.parameters.title,
                        action.parameters.id,
                    );
                    responseBody = "OK";
                    break;
                }
                case "deleteTabIdFromIndex": {
                    await tabTitleIndex.remove(action.parameters.id);
                    responseBody = "OK";
                    break;
                }
                case "resetTabIdToIndex": {
                    await tabTitleIndex.reset();
                    responseBody = "OK";
                    break;
                }
            }

            webSocketEndpoint.send(
                JSON.stringify({
                    id: requestId,
                    result: responseBody,
                }),
            );
        } catch (ex: any) {
            if (ex instanceof Error) {
                console.error(ex);
            } else {
                console.error(JSON.stringify(ex));
            }

            throw new Error("Unable to contact browser backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}

export async function createAutomationBrowser(isVisible?: boolean) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(undefined), 10000);
    });

    const hiddenWindowPromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./puppeteer/index.mjs"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService, [
                    isVisible ? "true" : "false",
                ]);

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Browser instance exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([hiddenWindowPromise, timeoutPromise]).then(
        (result) => {
            clearTimeout(timeoutHandle);
            return result;
        },
    );
}

class OpenStandaloneBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Open a standalone browser instance";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
        context.sessionContext.agentContext.browserProcess =
            await createAutomationBrowser(true);
    }
}

class OpenHiddenBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Open a hidden/headless browser instance";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
        context.sessionContext.agentContext.browserProcess =
            await createAutomationBrowser(false);
    }
}

class CloseBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
    }
}

export const handlers: CommandHandlerTable = {
    description: "Browser App Agent Commands",
    commands: {
        launch: {
            description: "Launch a browser session",
            defaultSubCommand: "standalone",
            commands: {
                hidden: new OpenHiddenBrowserHandler(),
                standalone: new OpenStandaloneBrowserHandler(),
            },
        },
        close: new CloseBrowserHandler(),
    },
};
