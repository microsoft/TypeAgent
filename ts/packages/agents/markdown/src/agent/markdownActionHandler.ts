// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    Storage,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { MarkdownAction } from "./markdownActionSchema.js";
import { createMarkdownAgent } from "./translator.js";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMarkdownContext,
        updateAgentContext: updateMarkdownContext,
        executeAction: executeMarkdownAction,
        validateWildcardMatch: markdownValidateWildcardMatch,
    };
}

type MarkdownActionContext = {
    currentFileName?: string | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
};

async function executeMarkdownAction(
    action: AppAction,
    context: ActionContext<MarkdownActionContext>,
) {
    let result = await handleMarkdownAction(action as MarkdownAction, context);
    return result;
}

async function markdownValidateWildcardMatch(
    action: AppAction,
    context: SessionContext<MarkdownActionContext>,
) {
    return true;
}

async function initializeMarkdownContext(
    settings?: AppAgentInitSettings,
): Promise<MarkdownActionContext> {
    const localHostPort = settings?.localHostPort;
    if (localHostPort === undefined) {
        throw new Error("Local view port not assigned.");
    }
    return {
        localHostPort: localHostPort,
    };
}

async function updateMarkdownContext(
    enable: boolean,
    context: SessionContext<MarkdownActionContext>,
): Promise<void> {
    if (enable) {
        if (!context.agentContext.currentFileName) {
            context.agentContext.currentFileName = "live.md";
        }

        const storage = context.sessionStorage;
        const fileName = context.agentContext.currentFileName;

        if (!(await storage?.exists(fileName))) {
            await storage?.write(fileName, "");
        }

        if (!context.agentContext.viewProcess) {
            const fullPath = await getFullMarkdownFilePath(fileName, storage!);
            if (fullPath) {
                process.env.MARKDOWN_FILE = fullPath;
                context.agentContext.viewProcess = await createViewServiceHost(
                    fullPath,
                    context.agentContext.localHostPort,
                );
            }
        }
    } else {
        // shut down service
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

async function getFullMarkdownFilePath(fileName: string, storage: Storage) {
    const paths = await storage?.list("", { fullPath: true });
    const candidates = paths?.filter((item) => item.endsWith(fileName!));

    return candidates ? candidates[0] : undefined;
}

async function handleMarkdownAction(
    action: MarkdownAction,
    actionContext: ActionContext<MarkdownActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    const agent = await createMarkdownAgent("GPT_4o");
    const storage = actionContext.sessionContext.sessionStorage;

    switch (action.actionName) {
        case "openDocument":
        case "createDocument": {
            if (!action.parameters.name) {
                result = createActionResult(
                    "Document could not be created: no name was provided",
                );
            } else {
                result = createActionResult("Opening document ...");

                const newFileName = action.parameters.name.trim() + ".md";
                actionContext.sessionContext.agentContext.currentFileName =
                    newFileName;

                if (!(await storage?.exists(newFileName))) {
                    await storage?.write(newFileName, "");
                }

                if (actionContext.sessionContext.agentContext.viewProcess) {
                    const fullPath = await getFullMarkdownFilePath(
                        newFileName,
                        storage!,
                    );

                    actionContext.sessionContext.agentContext.viewProcess.send({
                        type: "setFile",
                        filePath: fullPath,
                    });
                }
                result = createActionResult("Document opened");
            }
            break;
        }
        case "updateDocument": {
            result = createActionResult("Updating document ...");

            const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;
            let markdownContent;
            if (await storage?.exists(filePath)) {
                markdownContent = await storage?.read(filePath, "utf8");
            }
            const response = await agent.updateDocument(
                markdownContent,
                action.parameters.originalRequest,
            );

            if (response.success) {
                const mdResult = response.data;

                // write to file
                if (mdResult.content) {
                    await storage?.write(filePath, mdResult.content);
                }
                if (mdResult.operationSummary) {
                    result = createActionResult(mdResult.operationSummary);
                } else {
                    result = createActionResult("Updated document");
                }
            } else {
                console.error(response.message);
            }
            break;
        }
    }
    return result;
}

export async function createViewServiceHost(filePath: string, port: number) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Markdown view service creation timed out")),
            10000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./view/route/service.js"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService, [port.toString()]);

                childProcess.send({
                    type: "setFile",
                    filePath: filePath,
                });

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Markdown view server exited with code:", code);
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
