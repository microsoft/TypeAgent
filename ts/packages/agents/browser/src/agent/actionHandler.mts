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
    ResolveEntityResult,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
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
import { BrowserActions, OpenWebPage } from "./actionsSchema.mjs";
import {
    resolveURLWithHistory,
    importWebsiteData,
    searchWebsites,
    getWebsiteStats,
} from "./websiteMemory.mjs";
import { CrosswordActions } from "./crossword/schema/userActions.mjs";
import { InstacartActions } from "./instacart/schema/userActions.mjs";
import { ShoppingActions } from "./commerce/schema/userActions.mjs";
import { SchemaDiscoveryActions } from "./discovery/schema/discoveryActions.mjs";
import { ExternalBrowserActions } from "./externalBrowserActionSchema.mjs";
import { BrowserControl } from "../common/browserControl.mjs";
import * as website from "website-memory";
import { openai, TextEmbeddingModel } from "aiclient";
import { urlResolver, bingWithGrounding } from "azure-ai-foundry";
import { createExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";

const debug = registerDebug("typeagent:browser:action");
const debugWebSocket = registerDebug("typeagent:browser:ws");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeBrowserContext,
        updateAgentContext: updateBrowserContext,
        executeAction: executeBrowserAction,
        resolveEntity,
        ...getCommandInterface(handlers),
    };
}

export type BrowserActionContext = {
    clientBrowserControl?: BrowserControl | undefined;
    externalBrowserControl?: BrowserControl | undefined;
    useExternalBrowserControl: boolean;
    webSocket?: WebSocket | undefined;
    webAgentChannels?: WebAgentChannels | undefined;
    crossWordState?: Crossword | undefined;
    browserConnector?: BrowserConnector | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: TextEmbeddingModel | undefined;
    index: website.IndexData | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
};

export interface urlResolutionAction {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}

async function initializeBrowserContext(
    settings?: AppAgentInitSettings,
): Promise<BrowserActionContext> {
    const clientBrowserControl = settings?.options as
        | BrowserControl
        | undefined;

    const localHostPort = settings?.localHostPort;
    if (localHostPort === undefined) {
        throw new Error("Local view port not assigned.");
    }
    return {
        clientBrowserControl,
        useExternalBrowserControl: clientBrowserControl === undefined,
        index: undefined,
        localHostPort,
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

        // Load the website index from disk
        if (!context.agentContext.websiteCollection) {
            const websiteIndexes = await context.indexes("website");

            if (websiteIndexes.length > 0) {
                context.agentContext.index = websiteIndexes[0];
                context.agentContext.websiteCollection =
                    await website.WebsiteCollection.readFromFile(
                        websiteIndexes[0].path,
                        "index",
                    );
                debug(
                    `Loaded website index with ${context.agentContext.websiteCollection?.messages.length || 0} websites`,
                );
            } else {
                debug(
                    "Unable to load website index, please create one using the @index command or import website data.",
                );
                // Create empty collection as fallback
                context.agentContext.websiteCollection =
                    new website.WebsiteCollection();
            }
        }

        // Initialize fuzzy matching model for website search
        if (!context.agentContext.fuzzyMatchingModel) {
            context.agentContext.fuzzyMatchingModel =
                openai.createEmbeddingModel();
        }

        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess = await createViewServiceHost(
                context.agentContext.localHostPort,
            );
        }

        if (context.agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket("browser", "dispatcher");
        if (webSocket) {
            context.agentContext.webSocket = webSocket;
            const browserControls = createExternalBrowserClient(webSocket);
            context.agentContext.externalBrowserControl = browserControls;
            context.agentContext.browserConnector = new BrowserConnector(
                context,
            );

            webSocket.onclose = (event: object) => {
                debugWebSocket("Browser webSocket connection closed.");
                context.agentContext.webSocket = undefined;
            };
            webSocket.addEventListener("message", async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text);
                debugWebSocket(`Received message from browser: ${text}`);
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
                                browserControls.setAgentStatus(
                                    true,
                                    `Initializing ${targetTranslator}`,
                                );
                                try {
                                    context.agentContext.crossWordState =
                                        await getBoardSchema(context);

                                    browserControls.setAgentStatus(
                                        false,
                                        `Finished initializing ${targetTranslator}`,
                                    );
                                } catch (e) {
                                    browserControls.setAgentStatus(
                                        false,
                                        `Failed to initialize ${targetTranslator}`,
                                    );
                                }

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

        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

async function resolveEntity(
    type: string,
    name: string,
    context: SessionContext<BrowserActionContext>,
): Promise<ResolveEntityResult | undefined> {
    if (type === "WebPage") {
        try {
            const url = await resolveWebPage(context, name);
            if (url) {
                return {
                    match: "exact",
                    entities: [
                        {
                            name,
                            type: ["WebPage"],
                            uniqueId: url,
                        },
                    ],
                };
            }
        } catch {}
    }
    return undefined;
}

async function resolveWebPage(
    context: SessionContext<BrowserActionContext>,
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
            if (URL.canParse(site)) {
                // if the site is a valid URL, return it directly
                debug(`Site is a valid URL: ${site}`);
                return site;
            }

            try {
                // handle browser views
                if (site === "planViewer") {
                    const port =
                        await context.getSharedLocalHostPort("browser");
                    if (port !== undefined) {
                        debug(`Resolved local site on PORT ${port}`);

                        return `http://localhost:${port}/plans`;
                    }
                }

                const port = await context.getSharedLocalHostPort(site);

                if (port !== undefined) {
                    debug(`Resolved local site on PORT ${port}`);

                    return `http://localhost:${port}`;
                }
            } catch (e) {
                debug(`Unable to find local host port for '${site}. ${e}'`);
            }

            // try to resolve URL using website visit history first
            const historyUrl = await resolveURLWithHistory(context, site);
            if (historyUrl) {
                debug(`Resolved URL from history: ${historyUrl}`);
                return historyUrl;
            }

            // try to resolve URL using LLM + internet search
            const url = await urlResolver.resolveURLWithSearch(
                site,
                bingWithGrounding.apiSettingsFromEnv(),
            );

            if (url) {
                return url;
            }

            // can't get a URL
            throw new Error(`Unable to find a URL for: '${site}'`);
    }
}

export function getActionBrowserControl(
    actionContext: ActionContext<BrowserActionContext>,
) {
    return getBrowserControl(actionContext.sessionContext.agentContext);
}
export function getSessionBrowserControl(
    sessionContext: SessionContext<BrowserActionContext>,
) {
    return getBrowserControl(sessionContext.agentContext);
}

export function getBrowserControl(agentContext: BrowserActionContext) {
    const browserControl = agentContext.useExternalBrowserControl
        ? agentContext.externalBrowserControl
        : agentContext.clientBrowserControl;
    if (!browserControl) {
        throw new Error(
            `${agentContext.externalBrowserControl ? "External" : "Client"} browser control is not available.`,
        );
    }
    return browserControl;
}

async function openWebPage(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<OpenWebPage>,
) {
    const browserControl = getActionBrowserControl(context);

    displayStatus(`Opening web page for ${action.parameters.site}.`, context);
    const siteEntity = action.entities?.site;
    const url =
        siteEntity?.type[0] === "WebPage"
            ? siteEntity.uniqueId!
            : await resolveWebPage(
                  context.sessionContext,
                  action.parameters.site,
              );

    if (url !== action.parameters.site) {
        displayStatus(
            `Opening web page for ${action.parameters.site} at ${url}.`,
            context,
        );
    }
    await browserControl.openWebPage(url);
    const result = createActionResult("Web page opened successfully.");

    result.activityContext = {
        activityName: "browsingWebPage",
        description: "Browsing a web page",
        state: {
            site: siteEntity?.name,
        },
        activityEndAction: {
            actionName: "closeWebPage",
        },
    };
    return result;
}

async function closeWebPage(context: ActionContext<BrowserActionContext>) {
    const browserControl = getActionBrowserControl(context);
    context.actionIO.setDisplay("Closing web page.");
    await browserControl.closeWebPage();
    const result = createActionResult("Web page closed successfully.");
    result.activityContext = null; // clear the activity context.
    return result;
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
                return openWebPage(context, action);
            case "closeWebPage":
                return closeWebPage(context);
            case "importWebsiteData":
                return importWebsiteData(context, action);
            case "searchWebsites":
                return searchWebsites(context, action);
            case "getWebsiteStats":
                return getWebsiteStats(context, action);
            case "goForward":
                await getActionBrowserControl(context).goForward();
                return;
            case "goBack":
                await getActionBrowserControl(context).goBack();
                return;
            case "reloadPage":
                // REVIEW: do we need to clear page schema?
                await getActionBrowserControl(context).reload();
                return;
            case "scrollUp":
                await getActionBrowserControl(context).scrollUp();
                return;
            case "scrollDown":
                await getActionBrowserControl(context).scrollDown();
                return;
            case "zoomIn":
                await getActionBrowserControl(context).zoomIn();
                return;
            case "zoomOut":
                await getActionBrowserControl(context).zoomOut();
                return;
            case "zoomReset":
                await getActionBrowserControl(context).zoomReset();
                return;
            case "followLinkByText": {
                const control = getActionBrowserControl(context);
                const { keywords, openInNewTab } = action.parameters;
                const url = await control.followLinkByText(
                    keywords,
                    openInNewTab,
                );
                if (!url) {
                    throw new Error(`No link found for '${keywords}'`);
                }

                return createActionResultFromMarkdownDisplay(
                    `Navigated to link for [${keywords}](${url})`,
                    `Navigated to link for '${keywords}'`,
                );
            }
            case "followLinkByPosition":
                const control = getActionBrowserControl(context);
                const url = await control.followLinkByPosition(
                    action.parameters.position,
                    action.parameters.openInNewTab,
                );
                if (!url) {
                    throw new Error(
                        `No link found at position ${action.parameters.position}`,
                    );
                }
                return createActionResultFromMarkdownDisplay(
                    `Navigated to [link](${url}) at position ${action.parameters.position}`,
                    `Navigated to link at position ${action.parameters.position}`,
                );
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

export async function createViewServiceHost(port: number) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Browser views service creation timed out")),
            10000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./views/server/server.mjs"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService, [port.toString()]);

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Browser views server exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
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
                    debug("Browser instance exited with code:", code);
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
        const result = await openWebPage(context, {
            actionName: "openWebPage",
            schemaName: "browser",
            parameters: {
                site: params.args.site,
            },
        });
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
        external: {
            description: "Toggle external browser control",
            defaultSubCommand: "on",
            commands: {
                on: {
                    description: "Enable external browser control",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        if (agentContext.externalBrowserControl === undefined) {
                            throw new Error(
                                "External browser control is not available.",
                            );
                        }
                        agentContext.useExternalBrowserControl = true;
                        displaySuccess(
                            "Using external browser control.",
                            context,
                        );
                    },
                },
                off: {
                    description: "Disable external browser control",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        if (agentContext.clientBrowserControl === undefined) {
                            throw new Error(
                                "Client browser control is not available.",
                            );
                        }
                        agentContext.useExternalBrowserControl = false;
                        displaySuccess("Use client browser control.", context);
                    },
                },
            },
        },
    },
};
