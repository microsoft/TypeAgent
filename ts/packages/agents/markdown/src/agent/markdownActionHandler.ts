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
import { DocumentOperation } from "./markdownOperationSchema.js";
import { createMarkdownAgent } from "./translator.js";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { UICommandResult } from "./ipcTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:markdown:agent");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMarkdownContext,
        updateAgentContext: updateMarkdownContext,
        executeAction: executeMarkdownAction, // Wrapper function
        validateWildcardMatch: markdownValidateWildcardMatch,
        streamPartialAction: streamPartialMarkdownAction,
    };
}

async function executeMarkdownAction(
    action: AppAction,
    context: ActionContext<MarkdownActionContext>,
) {
    let result = await handleMarkdownAction(action as MarkdownAction, context);
    return result;
}

type MarkdownActionContext = {
    currentFileName?: string | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
};

async function handleUICommand(
    command: string,
    parameters: any,
    context: ActionContext<MarkdownActionContext>,
): Promise<UICommandResult> {
    debug(
        `[AGENT] Processing UI command: ${command}, cursorPosition: ${parameters.cursorPosition}, context: ${parameters.context ? "received" : "none"}, originalRequest: ${parameters.originalRequest}`,
    );

    try {
        // Check if streaming is enabled for this command
        const enableStreaming =
            parameters.enableStreaming && parameters.streamId;
        const streamId = parameters.streamId;

        if (enableStreaming) {
            debug(
                `[AGENT] Processing streaming command: ${command}, stream: ${streamId}`,
            );

            // Build action from UI command
            const action: MarkdownAction = {
                actionName: "streamingUpdateDocument",
                parameters: {
                    originalRequest: parameters.originalRequest,
                    context: parameters.context, // Already serialized by view
                    cursorPosition: parameters.cursorPosition, // Explicit position
                },
            };

            const result = await handleStreamingMarkdownAction(
                action,
                context,
                streamId,
            );

            return {
                success: true,
                operations: (result as any).data?.operations || [],
                message:
                    (result as any).data?.operationSummary ||
                    "Streaming command completed successfully",
                type: "success",
            };
        } else {
            // Non-streaming command - use existing flow
            const action: MarkdownAction = {
                actionName: "updateDocument",
                parameters: {
                    originalRequest: parameters.originalRequest,
                    context: parameters.context, // Already serialized by view
                    cursorPosition: parameters.cursorPosition, // Explicit position
                },
            };

            const result = await handleMarkdownAction(action, context);

            return {
                success: true,
                operations: (result as any).data?.operations || [],
                message:
                    (result as any).data?.operationSummary ||
                    "Command completed successfully",
                type: "success",
            };
        }
    } catch (error) {
        console.error(`[AGENT] UI command failed:`, error);
        return {
            success: false,
            error: (error as Error).message,
            message: `Failed to execute ${command} command`,
            type: "error",
        };
    }
}

async function streamPartialMarkdownAction(
    actionName: string,
    name: string,
    value: string,
    delta: string | undefined,
    context: ActionContext<MarkdownActionContext>,
): Promise<void> {
    if (actionName !== "streamingUpdateDocument") {
        return;
    }

    debug(`Streaming ${name}: delta="${delta}"`);

    switch (name) {
        case "parameters.generatedContent":
            handleStreamingContent(delta, context);
            break;

        case "parameters.progressStatus":
            handleProgressUpdate(delta, context);
            break;

        case "parameters.validationResults":
            handleValidationFeedback(delta, context);
            break;
    }
}

function handleStreamingContent(
    delta: string | undefined,
    context: ActionContext<MarkdownActionContext>,
): void {
    if (delta === undefined) {
        context.actionIO.appendDisplay("");
        debug("Streaming completed");
        return;
    }

    if (delta) {
        // Accumulate streaming content
        if (context.streamingContext === undefined) {
            context.streamingContext = "";
        }
        context.streamingContext += delta;

        // Show delta to user
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: delta,
                speak: false, // Don't speak markdown content
            },
            "inline",
        );
    }
}

function handleProgressUpdate(
    delta: string | undefined,
    context: ActionContext<MarkdownActionContext>,
): void {
    if (delta) {
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: `[UPDATE] ${delta}`,
                kind: "status",
            },
            "temporary",
        );
    }
}

function handleValidationFeedback(
    delta: string | undefined,
    context: ActionContext<MarkdownActionContext>,
): void {
    if (delta) {
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: `[COMPLETE] ${delta}`,
                kind: "info",
            },
            "block",
        );
    }
}

async function handleUICommandViaIPC(
    message: any,
    agentContext: MarkdownActionContext,
): Promise<UICommandResult> {
    debug(
        `[AGENT] Processing UI command: ${message.command}, requestId: ${message.requestId}`,
    );

    try {
        // Create minimal action context for UI commands
        const actionContext = {
            sessionContext: {
                agentContext: agentContext,
            },
        } as ActionContext<MarkdownActionContext>;

        const result = await handleUICommand(
            message.command,
            message.parameters,
            actionContext,
        );

        debug(
            `[AGENT] UI command completed successfully: ${message.requestId}`,
        );
        return result;
    } catch (error) {
        console.error(`[AGENT] UI command failed: ${message.requestId}`, error);

        // Return error result instead of throwing to ensure response is sent
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: `Failed to execute ${message.command} command`,
            type: "error",
        };
    }
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
        // Store agent context for UI command processing
        setCurrentAgentContext(context.agentContext);

        if (!context.agentContext.currentFileName) {
            context.agentContext.currentFileName = "live.md";
        }

        const storage = context.sessionStorage;
        const fileName = context.agentContext.currentFileName;

        if (!(await storage?.exists(fileName))) {
            await storage?.write(fileName, "");
        }

        debug(
            `Agent context updated for: ${fileName}, port: ${context.agentContext.localHostPort}`,
        );

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

        setCurrentAgentContext(context.agentContext);
    } else {
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
            context.agentContext.viewProcess = undefined;
        }
    }
}

/**
 * Handle streaming markdown actions that send content chunks to view process
 */
async function handleStreamingMarkdownAction(
    action: MarkdownAction,
    actionContext: ActionContext<MarkdownActionContext>,
    streamId: string,
): Promise<ActionResult> {
    debug(
        `[AGENT] Starting streaming action: ${action.actionName} (stream: ${streamId})`,
    );

    const agent = await createMarkdownAgent("GPT_4o");
    const storage = actionContext.sessionContext.sessionStorage;

    // Get current document content
    const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;
    let markdownContent = "";

    if (actionContext.sessionContext.agentContext.viewProcess) {
        try {
            markdownContent = await getDocumentContentFromView(
                actionContext.sessionContext.agentContext.viewProcess,
            );
            debug(
                `Got content from view process for streaming: ${markdownContent?.length || 0} chars`,
            );
        } catch (error) {
            console.warn(
                "[STREAMING] Failed to get content from view, falling back to storage:",
                error,
            );
            if (await storage?.exists(filePath)) {
                markdownContent = (await storage?.read(filePath, "utf8")) || "";
            }
        }
    } else {
        if (await storage?.exists(filePath)) {
            markdownContent = (await storage?.read(filePath, "utf8")) || "";
        }
    }

    try {
        // Call agent with streaming callback
        const originalRequest =
            "originalRequest" in action.parameters
                ? action.parameters.originalRequest
                : "";

        const cursorPosition =
            "cursorPosition" in action.parameters
                ? action.parameters.cursorPosition
                : undefined;

        const context =
            "context" in action.parameters && action.parameters.context
                ? (() => {
                      try {
                          return JSON.parse(action.parameters.context);
                      } catch (error) {
                          debug(
                              `[AGENT] Failed to parse context JSON: ${error}, using undefined`,
                          );
                          return undefined;
                      }
                  })()
                : undefined;

        const response = await agent.updateDocumentWithStreaming(
            markdownContent,
            originalRequest,
            (chunk: string) => {
                // Send chunk to view process for streaming to client
                sendStreamingChunkToView(streamId, chunk, actionContext);
            },
            cursorPosition,
            context,
        );

        if (response.success) {
            const updateResult = response.data;

            // Send completion signal with final operations
            if (updateResult) {
                sendStreamingCompleteToView(
                    streamId,
                    updateResult.operations || [],
                    actionContext,
                );

                return createActionResult(
                    updateResult.operationSummary ||
                        "Streaming content generated successfully",
                );
            } else {
                sendStreamingCompleteToView(streamId, [], actionContext);
                return createActionResult(
                    "Streaming content generated successfully",
                );
            }
        } else {
            // Send error completion
            sendStreamingCompleteToView(streamId, [], actionContext);

            throw new Error("Streaming failed: Unknown error");
        }
    } catch (error) {
        console.error(`[STREAMING] Streaming action failed:`, error);

        // Send error completion
        sendStreamingCompleteToView(streamId, [], actionContext);

        throw error;
    }
}

/**
 * Send streaming content chunk to view process
 */
function sendStreamingChunkToView(
    streamId: string,
    chunk: string,
    actionContext: ActionContext<MarkdownActionContext>,
): void {
    const viewProcess = actionContext.sessionContext.agentContext.viewProcess;
    if (viewProcess) {
        viewProcess.send({
            type: "streamingContent",
            streamId: streamId,
            chunk: chunk,
            timestamp: Date.now(),
        });
    } else {
        console.warn(`[AGENT] No view process available for streaming chunk`);
    }
}

/**
 * Send streaming completion to view process
 */
function sendStreamingCompleteToView(
    streamId: string,
    operations: any[],
    actionContext: ActionContext<MarkdownActionContext>,
): void {
    const viewProcess = actionContext.sessionContext.agentContext.viewProcess;
    if (viewProcess) {
        viewProcess.send({
            type: "streamingComplete",
            streamId: streamId,
            operations: operations,
            timestamp: Date.now(),
        });
    } else {
        console.warn(
            `[AGENT] No view process available for streaming completion`,
        );
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

                let newFileName = action.parameters.name.trim();
                if (!newFileName.endsWith(".md")) {
                    newFileName += ".md";
                }

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
                        filePath: path.basename(fullPath!),
                        folderPath: path.dirname(fullPath!),
                    });
                }
                result = createActionResult("Document opened");
                result.activityContext = {
                    activityName: "editingMarkdown",
                    description: "Editing a Markdown document",
                    state: {
                        fileName: newFileName,
                    },
                    openLocalView: true,
                };
            }
            break;
        }
        case "updateDocument": {
            debug("Starting updateDocument action in agent process");
            result = createActionResult("Updating document ...");

            const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;

            let markdownContent = "";

            if (actionContext.sessionContext.agentContext.viewProcess) {
                try {
                    markdownContent = await getDocumentContentFromView(
                        actionContext.sessionContext.agentContext.viewProcess,
                    );
                    debug(
                        `Got content from view process: ${markdownContent?.length || 0} chars`,
                    );
                    debug(
                        `Content preview: ${markdownContent?.substring(0, 200)}...`,
                    );
                } catch (error) {
                    console.warn(
                        "Failed to get content from view, using empty content fallback:",
                        error,
                    );
                    // Use empty content as fallback to allow agent to continue processing
                    markdownContent = "";
                    debug("Using empty content fallback");
                }
            } else {
                // Fallback if no view process
                if (await storage?.exists(filePath)) {
                    markdownContent =
                        (await storage?.read(filePath, "utf8")) || "";
                    debug(
                        "No view process, read content from storage:",
                        markdownContent?.length,
                        "chars",
                    );
                }
            }

            // Handle synchronous requests through the agent
            const originalRequest =
                "originalRequest" in action.parameters
                    ? action.parameters.originalRequest
                    : "";

            const cursorPosition =
                "cursorPosition" in action.parameters
                    ? action.parameters.cursorPosition
                    : undefined;

            const context =
                "context" in action.parameters && action.parameters.context
                    ? (() => {
                          try {
                              return JSON.parse(action.parameters.context);
                          } catch (error) {
                              debug(
                                  `[AGENT] Failed to parse context JSON: ${error}, using undefined`,
                              );
                              return undefined;
                          }
                      })()
                    : undefined;

            debug(
                `[AGENT] About to call LLM service with request: "${originalRequest}"`,
            );
            debug(
                `[AGENT] Document content length: ${markdownContent?.length || 0} chars`,
            );

            const response = await agent.updateDocument(
                markdownContent,
                originalRequest,
                cursorPosition,
                context,
            );

            debug(`[AGENT] LLM service returned, success: ${response.success}`);

            if (response.success) {
                const updateResult = response.data;
                debug(
                    `[AGENT] LLM processing successful, operations count: ${updateResult.operations?.length || 0}`,
                );

                // Apply operations to the document
                if (
                    updateResult.operations &&
                    updateResult.operations.length > 0
                ) {
                    // Send operations to view process for application
                    if (actionContext.sessionContext.agentContext.viewProcess) {
                        debug(
                            "Agent sending operations to view process for Yjs application",
                        );

                        const success = await sendOperationsToView(
                            actionContext.sessionContext.agentContext
                                .viewProcess,
                            updateResult.operations,
                        );

                        if (!success) {
                            throw new Error(
                                "Failed to apply operations in view process",
                            );
                        }

                        debug(
                            "Operations applied successfully via view process",
                        );
                    } else {
                        console.warn(
                            "No view process available, operations not applied",
                        );
                    }
                } else {
                    debug("[AGENT] No operations returned from LLM");
                }

                if (updateResult.operationSummary) {
                    result = createActionResult(updateResult.operationSummary);
                } else {
                    result = createActionResult("Updated document");
                }

                debug(`[AGENT] updateDocument case completed successfully`);
            } else {
                const errorMessage =
                    (response as any).message || "Unknown error occurred";
                console.error("Translation failed:", errorMessage);
                result = createActionResult(
                    "Failed to update document: " + errorMessage,
                );
            }
            break;
        }
        case "streamingUpdateDocument": {
            // Handle streaming AI commands - now unified with regular updateDocument flow
            debug(
                "Starting streamingUpdateDocument action - using standard translator flow",
            );
            result = createActionResult("Updating document ...");

            const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;

            let markdownContent = "";

            if (actionContext.sessionContext.agentContext.viewProcess) {
                try {
                    markdownContent = await getDocumentContentFromView(
                        actionContext.sessionContext.agentContext.viewProcess,
                    );
                    debug(
                        `Got content from view process: ${markdownContent?.length || 0} chars`,
                    );
                    debug(
                        `Content preview: ${markdownContent?.substring(0, 200)}...`,
                    );
                } catch (error) {
                    console.warn(
                        "Failed to get content from view, using empty content fallback:",
                        error,
                    );
                    // Use empty content as fallback to allow agent to continue processing
                    markdownContent = "";
                    debug("Using empty content fallback");
                }
            } else {
                // Fallback if no view process
                if (await storage?.exists(filePath)) {
                    markdownContent =
                        (await storage?.read(filePath, "utf8")) || "";
                    debug(
                        "No view process, read content from storage:",
                        markdownContent?.length,
                        "chars",
                    );
                }
            }

            // Handle streaming requests through the standard agent (same as updateDocument)
            const response = await agent.updateDocument(
                markdownContent,
                action.parameters.originalRequest,
            );

            if (response.success) {
                const updateResult = response.data;

                // Apply operations to the document
                if (
                    updateResult.operations &&
                    updateResult.operations.length > 0
                ) {
                    // Send operations to view process for application
                    if (actionContext.sessionContext.agentContext.viewProcess) {
                        debug(
                            "Agent sending operations to view process for Yjs application",
                        );

                        const success = await sendOperationsToView(
                            actionContext.sessionContext.agentContext
                                .viewProcess,
                            updateResult.operations,
                        );

                        if (!success) {
                            throw new Error(
                                "Failed to apply operations in view process",
                            );
                        }

                        debug(
                            "Operations applied successfully via view process",
                        );
                    } else {
                        console.warn(
                            "No view process available, operations not applied",
                        );
                    }
                }

                if (updateResult.operationSummary) {
                    result = createActionResult(updateResult.operationSummary);
                } else {
                    result = createActionResult("Updated document");
                }
            } else {
                const errorMessage =
                    (response as any).message || "Unknown error occurred";
                console.error("Translation failed:", errorMessage);
                result = createActionResult(
                    "Failed to update document: " + errorMessage,
                );
            }
            break;
        }
    }
    return result;
}

/**
 * Send operations to view process for application (Flow 1 implementation)
 */
async function sendOperationsToView(
    viewProcess: ChildProcess | undefined,
    operations: DocumentOperation[],
): Promise<boolean> {
    if (!viewProcess) {
        return false;
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error("[AGENT] View process operation timeout");
            resolve(false);
        }, 5000);

        // Listen for response
        const responseHandler = (message: any) => {
            if (message.type === "operationsApplied") {
                clearTimeout(timeout);
                viewProcess.off("message", responseHandler);

                if (message.success) {
                    resolve(true);
                } else {
                    console.error(
                        "[AGENT] View failed to apply operations:",
                        message.error,
                    );
                    resolve(false);
                }
            }
        };

        viewProcess.on("message", responseHandler);

        // Send operations
        viewProcess.send({
            type: "applyLLMOperations",
            operations: operations,
            timestamp: Date.now(),
        });

        debug(`[AGENT] Sent ${operations.length} operations to view process`);
    });
}

/**
 * Get document content from view process (Flow 1 implementation)
 */
async function getDocumentContentFromView(
    viewProcess: ChildProcess,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            debug(
                "[AGENT] Content request timeout, trying fallback to empty content",
            );

            // Use empty content as fallback when view process fails
            // This allows the agent to continue processing even if content retrieval fails
            console.warn(
                "[AGENT] View process content request timed out, using empty content fallback",
            );
            resolve("");
        }, 15000); // 15 second timeout

        const responseHandler = (message: any) => {
            if (message.type === "documentContent") {
                clearTimeout(timeout);
                viewProcess.off("message", responseHandler);

                // Log the source of the content for debugging
                const source = message.source || "unknown";
                debug(
                    `[AGENT] Received document content from ${source}: ${message.content?.length || 0} chars`,
                );

                if (message.error) {
                    debug(
                        `[AGENT] Content retrieval had error: ${message.error}`,
                    );
                    // Still resolve with content even if there was an error
                }

                resolve(message.content || "");
            }
        };

        viewProcess.on("message", responseHandler);

        debug("[AGENT] Sending getDocumentContent request to view process");
        viewProcess.send({ type: "getDocumentContent" });
    });
}
// NOTE: Function commented out per Flow 1 consolidation
// Collaboration server now managed by view process

export async function createViewServiceHost(filePath: string, port: number) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            console.log("Markdown view service creation timed out");
            reject(new Error("Markdown view service creation timed out"));
        }, 10000);
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

                const folderPath = path.dirname(filePath!);

                const childProcess = fork(expressService, [port.toString()], {
                    env: {
                        ...process.env,
                        TYPEAGENT_MARKDOWN_ROOT: folderPath,
                    },
                });

                childProcess.send({
                    type: "setFile",
                    filePath: path.basename(filePath),
                });

                childProcess.on("message", function (message: any) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    debug("Markdown view server exited with code:", code);
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

// Global process message handler for UI commands
let currentAgentContext: MarkdownActionContext | null = null;

// Store agent context for UI command processing
export function setCurrentAgentContext(context: MarkdownActionContext) {
    currentAgentContext = context;

    const viewProcess = context.viewProcess;

    if (typeof viewProcess !== "undefined" && viewProcess.on) {
        viewProcess.on("message", async (message: any) => {
            if (message.type === "uiCommand" && currentAgentContext) {
                debug(
                    `[AGENT] Received UI command: ${message.command}, requestId: ${message.requestId}, cursorPosition: ${message.parameters?.cursorPosition}, context: ${message.parameters?.context ? "serialized" : "none"}`,
                );

                try {
                    debug(
                        `[AGENT] Starting to process UI command: ${message.requestId}`,
                    );
                    const result = await handleUICommandViaIPC(
                        message,
                        currentAgentContext,
                    );

                    debug(
                        `[AGENT] UI command ${message.requestId} completed successfully, sending result`,
                    );
                    viewProcess.send?.({
                        type: "uiCommandResult",
                        requestId: message.requestId,
                        result: result,
                    });
                    debug(
                        `[AGENT] Result sent for UI command: ${message.requestId}`,
                    );
                } catch (error) {
                    console.error(
                        `[AGENT] UI command ${message.requestId} failed:`,
                        error,
                    );

                    // Always send error response to prevent timeout
                    const errorResult = {
                        success: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                        message: "Internal error processing UI command",
                        type: "error" as const,
                    };

                    debug(
                        `[AGENT] Sending error result for UI command: ${message.requestId}`,
                    );
                    viewProcess.send?.({
                        type: "uiCommandResult",
                        requestId: message.requestId,
                        result: errorResult,
                    });
                }
            }
        });
    }
}
