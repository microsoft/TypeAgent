// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocket } from "common-utils/ws";
import { WebSocket } from "ws";
import {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentEvent,
    AppAgentInitSettings,
    ParsedCommandParams,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { displayError } from "@typeagent/agent-sdk/helpers/display";
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
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

import registerDebug from "debug";

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
import { ExternalBrowserActions } from "./externalBrowserActionSchema.mjs";
import { BrowserControl } from "./interface.mjs";
import { bingWithGrounding } from "aiclient";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { Agent, MessageContentUnion, ThreadMessage, ToolUtility } from "@azure/ai-agents";

const debug = registerDebug("typeagent:browser:action");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeBrowserContext,
        updateAgentContext: updateBrowserContext,
        executeAction: executeBrowserAction,
        ...getCommandInterface(handlers),
    };
}

export type BrowserActionContext = {
    browserControl?: BrowserControl | undefined;
    webSocket?: WebSocket | undefined;
    webAgentChannels?: WebAgentChannels | undefined;
    crossWordState?: Crossword | undefined;
    browserConnector?: BrowserConnector | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
};

async function initializeBrowserContext(
    settings?: AppAgentInitSettings,
): Promise<BrowserActionContext> {
    const browserControl = settings?.options as BrowserControl | undefined;
    return {
        browserControl,
    };
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

async function resolveWebSite(
    context: ActionContext<BrowserActionContext>,
    site: string,
): Promise<string> {
    debug(`Resolving site '${site}'`);

    switch (site.toLowerCase()) {
        case "paleobiodb":
            return "https://paleobiodb.org/navigator/";

        case "crossword":
            return "https://aka.ms/typeagent/sample-crossword";

        case "commerce":
            return "https://www.target.com/";

        case "turtlegraphics":
            return "http://localhost:9000/";
        default:

            // try to resolve URL using LLM + internet search
            const url = await resolveURLWithSearch(site);

            if (url) {
                return url;
            }

            // get local agent
            const port = await context.sessionContext.getSharedLocalHostPort(site);

            if (port !== undefined) {
                debug(`Resolved local site on PORT ${port}`);
                return `http://localhost:${port}`;
            }

            // can't get a URL
            throw new Error(`Unable to find a URL for: '${site}'`);
    }
}

let groundingConfig: bingWithGrounding.ApiSettings | undefined;
async function resolveURLWithSearch(site: string) : Promise<string | undefined> {
    
    if (!groundingConfig) {
        groundingConfig = bingWithGrounding.apiSettingsFromEnv();
    }

    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );    
    
    const agent = await ensureAgent(groundingConfig, project); 

    if (!agent) {
        throw new Error("No agent found for Bing with Grounding. Please check your configuration.");
    }

    const thread = await project.agents.threads.create();

    // the question that needs answering
    await project.agents.messages.create(
        thread.id,
        "user",
        site,
    );

    // Create run
    const run = await project.agents.runs.createAndPoll(thread.id, 
        agent.id, 
        {
            pollingOptions: {
                intervalInMs: 500,
            },
            onResponse: (response): void => {
                console.log(`Received response with status: ${response.status}`);
            },
        });

    const msgs: ThreadMessage[] = [];
    if (run.status === "completed") {
        if (run.completedAt) {
            // Retrieve messages
            const messages = await project.agents.messages.list(thread.id, {
                order: "asc",
            });

            // accumulate assistant messages                
            for await (const m of messages) {
                if (m.role === "assistant") {
                    // TODO: handle multi-modal content
                    const content: MessageContentUnion | undefined = m.content.find(
                        (c) => c.type === "text" && "text" in c,
                    );
                    if (content) {
                        msgs.push(m);
                    }
                }
            }
        }
    }

    // delete the thread we just created since we are currently one and done
    project.agents.threads.delete(thread.id);

    // return assistant messages
    return msgs.join("\n");    
}

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
async function ensureAgent(groundingConfig: bingWithGrounding.ApiSettings, project: AIProjectClient) : Promise<Agent | undefined> {
    
    let agent : Agent | undefined;

    try {
        agent = await project.agents.getAgent("TypeAgent_URLResolverAgent");
    } catch (e) {
        const bingTool = ToolUtility.createBingGroundingTool([{ connectionId: "bingwithgrounding" }]);

        // try to create the agent
        agent = await project.agents.createAgent("gpt-4o", {
            description: "Auto created URL Resolution Agent",
            instructions: `
You are an agent that translates user requests in conjunction with search results to URLs.  If the page does not exist just return an empty URL. Do not make up URLs.

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}
            `,
            tools: [ bingTool.definition ],
        });
    }

    return agent;
}

async function openWebPage(
    context: ActionContext<BrowserActionContext>,
    site: string,
) {
    if (context.sessionContext.agentContext.browserControl) {
        context.actionIO.setDisplay("Opening web page.");
        await context.sessionContext.agentContext.browserControl.openWebPage(
            await resolveWebSite(context, site),
        );
        const result = createActionResult("Web page opened successfully.");

        result.activityContext = {
            activityName: "browsingWebPage",
            description: "Browsing a web page",
            state: {
                site: site,
            },
            activityEndAction: {
                actionName: "closeWebPage",
            },
        };
        return result;
    }
    throw new Error(
        "Browser control is not available. Please launch a browser first.",
    );
}

async function closeWebPage(context: ActionContext<BrowserActionContext>) {
    if (context.sessionContext.agentContext.browserControl) {
        context.actionIO.setDisplay("Closing web page.");
        await context.sessionContext.agentContext.browserControl.closeWebPage();
        const result = createActionResult("Web page closed successfully.");
        result.activityContext = null; // clear the activity context.
        return result;
    }
    throw new Error(
        "Browser control is not available. Please launch a browser first.",
    );
}

async function executeBrowserAction(
    action:
        | TypeAgentAction<BrowserActions, "browser">
        | TypeAgentAction<ExternalBrowserActions, "browser.external">
        | TypeAgentAction<CrosswordActions, "browser.crossword">
        | TypeAgentAction<ShoppingActions, "browser.commerce">
        | TypeAgentAction<InstacartActions, "browser.instacart">
        | TypeAgentAction<SchemaDiscoveryActions, "browser.actionDiscovery">,

    context: ActionContext<BrowserActionContext>,
) {
    if (action.schemaName === "browser") {
        switch (action.actionName) {
            case "openWebPage":
                return openWebPage(context, action.parameters.site);
            case "closeWebPage":
                return closeWebPage(context);
        }
    }
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

class OpenStandaloneAutomationBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Open a standalone browser instance";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
        context.sessionContext.agentContext.browserProcess =
            await createAutomationBrowser(true);
    }
}

class OpenHiddenAutomationBrowserHandler implements CommandHandlerNoParams {
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

class OpenWebPageHandler implements CommandHandler {
    public readonly description = "Show a new Web Content view";
    public readonly parameters = {
        args: {
            site: {
                description: "Alias or URL for the site of the open.",
            },
        },
    } as const;
    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const result = await openWebPage(context, params.args.site);
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);
        // REVIEW: command doesn't set the activity context
    }
}

class CloseWebPageHandler implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<BrowserActionContext>) {
        const result = await closeWebPage(context);
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);

        // REVIEW: command doesn't clear the activity context
    }
}

export const handlers: CommandHandlerTable = {
    description: "Browser App Agent Commands",
    commands: {
        auto: {
            description: "Run the browser automation",
            defaultSubCommand: "launch",
            commands: {
                launch: {
                    description: "Launch a browser session",
                    defaultSubCommand: "standalone",
                    commands: {
                        hidden: new OpenHiddenAutomationBrowserHandler(),
                        standalone:
                            new OpenStandaloneAutomationBrowserHandler(),
                    },
                },
                close: new CloseBrowserHandler(),
            },
        },

        open: new OpenWebPageHandler(),
        close: new CloseWebPageHandler(),
    },
};
