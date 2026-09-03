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
import {
    CreateDocumentAction,
    MarkdownAction,
    OpenDocumentAction,
} from "./markdownActionSchema.js";
import { DocumentOperation } from "./markdownOperationSchema.js";
import { createMarkdownAgent } from "./translator.js";
import { ChildProcess, fork } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { UICommandResult } from "./ipcTypes.js";
import registerDebug from "debug";
import {
    normalizeRelativeDocumentPath,
    resolveExistingFileWithinRoot,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "./pathPolicy.js";
import {
    computeContentRevision,
    persistDocumentOperations,
    readBoundDocument,
    type DocumentBinding,
} from "./documentUpdatePersistence.js";
import { applyDocumentOperations } from "./documentOperations.js";

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
    const result = await handleMarkdownAction(
        action as MarkdownAction,
        context,
    );
    return result;
}

type CurrentMarkdownDocument =
    | {
          source: "session";
          storageKey: string;
          binding?: DocumentBinding;
      }
    | {
          source: "workspace";
          filePath: string;
          workspaceRoot: string;
      };

type MarkdownActionContext = {
    currentDocument?: CurrentMarkdownDocument | undefined;
    currentBindingToken?: string | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
    // Handle returned by sessionContext.registerPort for the markdown
    // preview / Yjs WebSocket server. Released on
    // updateMarkdownContext(false, ...).
    viewPortRegistration?: { release: () => void } | undefined;
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

        if (context.agentContext.currentDocument === undefined) {
            context.agentContext.currentDocument = {
                source: "session",
                storageKey: "live.md",
            };
        }

        const storage = context.sessionStorage;
        const currentDocument = context.agentContext.currentDocument;
        const storageKey =
            currentDocument.source === "session"
                ? currentDocument.storageKey
                : undefined;

        if (storageKey && !(await storage?.exists(storageKey))) {
            await storage?.write(storageKey, "");
        }

        debug(
            `Agent context updated for: ${
                currentDocument.source === "session"
                    ? currentDocument.storageKey
                    : currentDocument.filePath
            }, port: ${context.agentContext.localHostPort}`,
        );

        if (
            !context.agentContext.viewProcess &&
            currentDocument.source === "session" &&
            storage
        ) {
            const fullPath = await getFullMarkdownFilePath(
                currentDocument.storageKey,
                storage,
            );
            if (fullPath) {
                currentDocument.binding = createSessionFileBinding(fullPath);
                process.env.MARKDOWN_FILE = fullPath;
                // Fork the express view service in the background instead of
                // blocking agent enable (and therefore agent-server startup)
                // on it. The view is only needed once the user actually opens
                // the markdown view; every action handler guards on
                // `viewProcess` presence, so early actions simply skip the
                // view until it's ready. This keeps a slow/cold view-service
                // fork (up to the 10s timeout) off the launch critical path.
                void createViewServiceHost(
                    fullPath,
                    context.agentContext.localHostPort,
                )
                    .then((result) => {
                        if (!result) {
                            return;
                        }
                        const viewProcess = result.process;
                        context.agentContext.viewProcess = viewProcess;
                        context.agentContext.localHostPort = result.port;
                        context.agentContext.viewPortRegistration?.release();
                        context.agentContext.viewPortRegistration =
                            context.registerPort("view", result.port);
                        // Defensive cleanup if the child crashes mid-session.
                        // The identity guard prevents a late-firing `exit`
                        // event on a previously-replaced process from
                        // clobbering a newer registration; the explicit
                        // disable path (which also releases) is naturally
                        // idempotent under `?.release()`.
                        viewProcess.once("exit", () => {
                            if (
                                context.agentContext.viewProcess !== viewProcess
                            ) {
                                return;
                            }
                            context.agentContext.viewPortRegistration?.release();
                            context.agentContext.viewPortRegistration =
                                undefined;
                            context.agentContext.viewProcess = undefined;
                        });
                        // Re-wire the UI-command message handler now that the
                        // view process exists (the earlier call below ran
                        // before it was forked).
                        setCurrentAgentContext(context.agentContext);
                        if (
                            context.agentContext.currentDocument?.source ===
                            "session"
                        ) {
                            const binding =
                                context.agentContext.currentDocument.binding;
                            if (binding) {
                                viewProcess.send({
                                    type: "setFile",
                                    workspaceRoot: binding.root,
                                    relativePath: binding.relativePath,
                                });
                            }
                        }
                    })
                    .catch((e) => {
                        console.warn(
                            "[AGENT] Markdown view service background start failed:",
                            e?.message ?? e,
                        );
                    });
            }
        }

        setCurrentAgentContext(context.agentContext);
    } else {
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
            context.agentContext.viewProcess = undefined;
            context.agentContext.viewPortRegistration?.release();
            context.agentContext.viewPortRegistration = undefined;
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
    const {
        content: markdownContent,
        binding,
        revision,
    } = await readCurrentDocumentContent(actionContext);

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
                if (updateResult.operations?.length) {
                    const operations =
                        updateResult.operations as DocumentOperation[];
                    const updatedContent = applyDocumentOperations(
                        markdownContent,
                        operations,
                    );
                    await applyOperationsForCurrentDocument(
                        actionContext,
                        operations,
                        binding,
                        revision,
                        computeContentRevision(updatedContent),
                    );
                }

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
    const viewProcess = getCurrentDocumentViewProcess(
        actionContext.sessionContext.agentContext,
    );
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
    const viewProcess = getCurrentDocumentViewProcess(
        actionContext.sessionContext.agentContext,
    );
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

function getCurrentDocumentViewProcess(
    agentContext: MarkdownActionContext,
): ChildProcess | undefined {
    return agentContext.currentDocument?.source === "session"
        ? agentContext.viewProcess
        : undefined;
}

function getDocumentName(rawName: unknown): string {
    const relativeCandidate = normalizeRelativeDocumentPath(rawName);
    if (relativeCandidate === undefined) {
        throw new Error(
            `Document name is not a safe relative path: ${JSON.stringify(rawName)}`,
        );
    }
    return relativeCandidate.toLowerCase().endsWith(".md")
        ? relativeCandidate
        : `${relativeCandidate}.md`;
}

async function getCurrentMarkdownContent(
    agentContext: MarkdownActionContext,
    storage: Storage | undefined,
): Promise<string> {
    const currentDocument = agentContext.currentDocument;
    if (currentDocument === undefined) {
        return "";
    }
    if (currentDocument.source === "workspace") {
        try {
            return await fs.promises.readFile(
                currentDocument.filePath,
                "utf-8",
            );
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                throw new Error(
                    `Current Markdown document no longer exists: ${currentDocument.filePath}`,
                );
            }
            throw error;
        }
    }
    if (
        storage !== undefined &&
        (await storage.exists(currentDocument.storageKey))
    ) {
        return (await storage.read(currentDocument.storageKey, "utf8")) ?? "";
    }
    return "";
}

async function handleCreateDocument(
    action: CreateDocumentAction,
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<ActionResult> {
    const rawName = action.parameters.name;
    const relativeName = getDocumentName(rawName);

    const initialContent = action.parameters.content ?? "";
    const workingDirectory = actionContext.workingDirectory;
    const storage = actionContext.sessionContext.sessionStorage;
    const agentContext = actionContext.sessionContext.agentContext;
    let documentExisted: boolean;
    let absoluteFilePath: string | undefined;

    if (workingDirectory === undefined) {
        if (storage === undefined) {
            throw new Error(
                "Markdown document creation requires a working directory or session storage",
            );
        }

        documentExisted = await storage.exists(relativeName);
        if (!documentExisted) {
            await storage.write(relativeName, initialContent);
        } else if (initialContent) {
            const existingContent = await storage.read(relativeName, "utf8");
            if (existingContent) {
                throw new Error(
                    `Document ${relativeName} already contains content`,
                );
            }
            await storage.write(relativeName, initialContent);
        }

        agentContext.currentDocument = {
            source: "session",
            storageKey: relativeName,
        };

        if (agentContext.viewProcess) {
            const fullPath = await getFullMarkdownFilePath(
                relativeName,
                storage,
            );
            if (fullPath) {
                agentContext.currentDocument.binding =
                    createSessionFileBinding(fullPath);
                agentContext.viewProcess.send({
                    type: "setFile",
                    workspaceRoot: fs.realpathSync(path.dirname(fullPath)),
                    relativePath: path.basename(fullPath),
                });
            }
        }
    } else {
        const canonicalRoot = resolveRealDirectory(workingDirectory);
        if (canonicalRoot === undefined) {
            throw new Error(
                `Configured working directory is not a real directory: ${workingDirectory}`,
            );
        }
        absoluteFilePath = resolveWritableFileWithinRoot(
            canonicalRoot,
            relativeName,
        );
        if (absoluteFilePath === undefined) {
            throw new Error(
                `Document path is not writable within the working directory: ${JSON.stringify(rawName)}`,
            );
        }

        documentExisted = fs.existsSync(absoluteFilePath);
        if (!documentExisted) {
            fs.writeFileSync(absoluteFilePath, initialContent, {
                encoding: "utf-8",
                flag: "wx",
            });
        } else if (initialContent) {
            const existingContent = fs.readFileSync(absoluteFilePath, "utf-8");
            if (existingContent) {
                throw new Error(
                    `Document ${relativeName} already contains content`,
                );
            }
            fs.writeFileSync(absoluteFilePath, initialContent, "utf-8");
        }

        agentContext.currentDocument = {
            source: "workspace",
            filePath: absoluteFilePath,
            workspaceRoot: canonicalRoot,
        };
    }

    agentContext.currentBindingToken = undefined;
    const actionLabel = documentExisted ? "opened" : "created";
    const documentLocation = absoluteFilePath ?? relativeName;
    const result = createActionResult(
        `Document ${actionLabel} at ${documentLocation}`,
    );
    result.resultEntity = {
        name: relativeName,
        type: ["file", "markdown"],
    };
    result.activityContext = {
        activityName: "editingMarkdown",
        description: "Editing a Markdown document",
        state: {
            fileName: relativeName,
        },
        openLocalView: agentContext.currentDocument.source === "session",
    };
    return result;
}

async function handleOpenDocument(
    action: OpenDocumentAction,
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<ActionResult> {
    const relativeName = getDocumentName(action.parameters.name);
    const workingDirectory = actionContext.workingDirectory;
    const storage = actionContext.sessionContext.sessionStorage;
    const agentContext = actionContext.sessionContext.agentContext;
    let documentLocation: string;

    if (workingDirectory === undefined) {
        if (storage === undefined || !(await storage.exists(relativeName))) {
            throw new Error(`Document does not exist: ${relativeName}`);
        }
        agentContext.currentDocument = {
            source: "session",
            storageKey: relativeName,
        };
        documentLocation = relativeName;

        if (agentContext.viewProcess) {
            const fullPath = await getFullMarkdownFilePath(
                relativeName,
                storage,
            );
            if (fullPath) {
                agentContext.currentDocument.binding =
                    createSessionFileBinding(fullPath);
                agentContext.viewProcess.send({
                    type: "setFile",
                    workspaceRoot: fs.realpathSync(path.dirname(fullPath)),
                    relativePath: path.basename(fullPath),
                });
            }
        }
    } else {
        const canonicalRoot = resolveRealDirectory(workingDirectory);
        if (canonicalRoot === undefined) {
            throw new Error(
                `Configured working directory is not a real directory: ${workingDirectory}`,
            );
        }
        const absoluteFilePath = resolveExistingFileWithinRoot(
            canonicalRoot,
            relativeName,
        );
        if (absoluteFilePath === undefined) {
            throw new Error(
                `Document does not exist within the working directory: ${relativeName}`,
            );
        }
        agentContext.currentDocument = {
            source: "workspace",
            filePath: absoluteFilePath,
            workspaceRoot: canonicalRoot,
        };
        documentLocation = absoluteFilePath;
    }

    agentContext.currentBindingToken = undefined;
    const result = createActionResult(`Document opened at ${documentLocation}`);
    result.resultEntity = {
        name: relativeName,
        type: ["file", "markdown"],
    };
    result.activityContext = {
        activityName: "editingMarkdown",
        description: "Editing a Markdown document",
        state: {
            fileName: relativeName,
        },
        openLocalView: agentContext.currentDocument.source === "session",
    };
    return result;
}

type DocumentUpdateAction = Extract<
    MarkdownAction,
    { actionName: "updateDocument" | "streamingUpdateDocument" }
>;

type CurrentDocumentBinding = DocumentBinding | { storageKey: string };

function createSessionFileBinding(fullPath: string): DocumentBinding {
    return {
        token: undefined,
        root: fs.realpathSync(path.dirname(fullPath)),
        relativePath: path.basename(fullPath),
        filePath: fs.realpathSync(fullPath),
    };
}

async function getCurrentDocumentBinding(
    agentContext: MarkdownActionContext,
    storage: Storage | undefined,
): Promise<CurrentDocumentBinding> {
    const currentDocument = agentContext.currentDocument;
    if (currentDocument === undefined) {
        throw new Error(
            "No markdown document is open. Use createDocument or openDocument first.",
        );
    }
    if (currentDocument.source === "session") {
        if (
            getCurrentDocumentViewProcess(agentContext) &&
            currentDocument.binding
        ) {
            return {
                ...currentDocument.binding,
                token: agentContext.currentBindingToken,
            };
        }
        if (storage === undefined) {
            throw new Error("Session storage is unavailable");
        }
        if (!getCurrentDocumentViewProcess(agentContext)) {
            return { storageKey: currentDocument.storageKey };
        }
        const fullPath = await getFullMarkdownFilePath(
            currentDocument.storageKey,
            storage,
        );
        if (fullPath === undefined) {
            throw new Error("Current session document has no local file");
        }
        return {
            ...createSessionFileBinding(fullPath),
            token: agentContext.currentBindingToken,
        };
    }
    return {
        token: agentContext.currentBindingToken,
        root: currentDocument.workspaceRoot,
        relativePath: path.relative(
            currentDocument.workspaceRoot,
            currentDocument.filePath,
        ),
        filePath: currentDocument.filePath,
    };
}

async function readCurrentDocumentContent(
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<{
    content: string;
    binding: CurrentDocumentBinding;
    revision: string;
}> {
    const agentContext = actionContext.sessionContext.agentContext;
    const storage = actionContext.sessionContext.sessionStorage;
    const binding = await getCurrentDocumentBinding(agentContext, storage);
    if ("storageKey" in binding) {
        const content = await getCurrentMarkdownContent(agentContext, storage);
        return { content, binding, revision: computeContentRevision(content) };
    }
    const viewProcess = getCurrentDocumentViewProcess(agentContext);
    if (!viewProcess) {
        const document = readBoundDocument(binding);
        return {
            content: document.content,
            binding,
            revision: document.revision,
        };
    }

    const response = await getDocumentContentFromView(viewProcess, {
        expectedBindingToken: binding.token,
        expectedRoot: binding.root,
        expectedRelativePath: binding.relativePath,
    });
    if (response.identityMismatch) {
        throw new Error(
            "Document identity changed while reading; refusing to update the wrong file",
        );
    }
    if (response.error) {
        throw new Error(response.error);
    }
    if (typeof response.bindingToken === "string") {
        agentContext.currentBindingToken = response.bindingToken;
    }
    return {
        content: response.content,
        binding: {
            ...binding,
            token: agentContext.currentBindingToken,
        },
        revision: response.revision ?? computeContentRevision(response.content),
    };
}

async function applyOperationsForCurrentDocument(
    actionContext: ActionContext<MarkdownActionContext>,
    operations: DocumentOperation[],
    binding: CurrentDocumentBinding,
    revision: string,
    expectedUpdatedRevision?: string,
): Promise<void> {
    const agentContext = actionContext.sessionContext.agentContext;
    const storage = actionContext.sessionContext.sessionStorage;
    const currentBinding = await getCurrentDocumentBinding(
        agentContext,
        storage,
    );
    if ("storageKey" in binding) {
        if (
            !("storageKey" in currentBinding) ||
            currentBinding.storageKey !== binding.storageKey
        ) {
            throw new Error("Document binding changed while generating update");
        }
        if (storage === undefined) {
            throw new Error("Session storage is unavailable");
        }
        const content = await getCurrentMarkdownContent(agentContext, storage);
        const currentRevision = computeContentRevision(content);
        if (currentRevision === expectedUpdatedRevision) {
            return;
        }
        if (currentRevision !== revision) {
            throw new Error(
                "Document changed between read and apply (revision mismatch)",
            );
        }
        const updatedContent = applyDocumentOperations(content, operations);
        if (
            expectedUpdatedRevision !== undefined &&
            computeContentRevision(updatedContent) !== expectedUpdatedRevision
        ) {
            throw new Error(
                "Updated document revision does not match operations",
            );
        }
        await storage.write(binding.storageKey, updatedContent);
        return;
    }
    if (
        "storageKey" in currentBinding ||
        currentBinding.token !== binding.token ||
        currentBinding.root !== binding.root ||
        currentBinding.relativePath !== binding.relativePath ||
        currentBinding.filePath !== binding.filePath
    ) {
        throw new Error("Document binding changed while generating update");
    }
    const expectations = {
        expectedBindingToken: binding.token,
        expectedRoot: binding.root,
        expectedRelativePath: binding.relativePath,
        expectedRevision: revision,
        expectedUpdatedRevision,
    };
    const viewProcess = getCurrentDocumentViewProcess(agentContext);
    if (!viewProcess) {
        persistDocumentOperations(binding, operations, {
            bindingToken: binding.token,
            root: binding.root,
            relativePath: binding.relativePath,
            revision,
            updatedRevision: expectedUpdatedRevision,
        });
        return;
    }

    const applied = await sendOperationsToView(
        viewProcess,
        operations,
        expectations,
    );
    if (applied.success) {
        return;
    }
    if (applied.identityMismatch) {
        throw new Error(
            "Document identity changed while applying operations; refusing to write to the wrong file",
        );
    }
    if (applied.revisionMismatch) {
        throw new Error(
            "Document changed between read and apply; refusing to overwrite (revision mismatch)",
        );
    }
    throw new Error(
        applied.error ?? "Failed to apply operations in view process",
    );
}

function parseEditorContext(serializedContext: string | undefined): unknown {
    if (!serializedContext) {
        return undefined;
    }
    try {
        return JSON.parse(serializedContext);
    } catch (error) {
        debug(
            `[AGENT] Failed to parse context JSON: ${
                error instanceof Error ? error.message : String(error)
            }, using undefined`,
        );
        return undefined;
    }
}

async function updateCurrentDocument(
    action: DocumentUpdateAction,
    actionContext: ActionContext<MarkdownActionContext>,
    agent: Awaited<ReturnType<typeof createMarkdownAgent>>,
): Promise<ActionResult> {
    const { content, binding, revision } =
        await readCurrentDocumentContent(actionContext);
    const response = await agent.updateDocument(
        content,
        action.parameters.originalRequest,
        action.parameters.cursorPosition,
        parseEditorContext(action.parameters.context),
    );
    if (!response.success) {
        const message =
            (response as { message?: string }).message ??
            "Unknown error occurred";
        return createActionResult(`Failed to update document: ${message}`);
    }

    if (response.data.operations?.length) {
        await applyOperationsForCurrentDocument(
            actionContext,
            response.data.operations,
            binding,
            revision,
        );
    }
    return createActionResult(
        response.data.operationSummary ?? "Updated document",
    );
}

async function handleMarkdownAction(
    action: MarkdownAction,
    actionContext: ActionContext<MarkdownActionContext>,
) {
    let result: ActionResult | undefined = undefined;

    // Accumulates the LLM token usage consumed while handling this action so
    // it can be reported back to the dispatcher as "Action Tokens". The agent
    // accumulates into this via the model's completion callback.
    const tokenUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };
    const createAgent = async () => {
        const agent = await createMarkdownAgent("GPT_4o");
        agent.tokenUsage = tokenUsage;
        return agent;
    };

    switch (action.actionName) {
        case "createDocument": {
            result = await handleCreateDocument(action, actionContext);
            break;
        }
        case "openDocument": {
            result = await handleOpenDocument(action, actionContext);
            break;
        }
        case "updateDocument":
        case "streamingUpdateDocument": {
            const agent = await createAgent();
            result = await updateCurrentDocument(action, actionContext, agent);
            break;
        }
    }

    // Attribute any LLM usage to the result. Action paths that made no LLM
    // call (e.g. open/create document) report all-zero usage, which the
    // dispatcher treats as "ran but no LLM call".
    if (result !== undefined && result.error === undefined) {
        result.tokenUsage = tokenUsage;
    }
    return result;
}

let applyRequestCounter = 0;

type ApplyExpectations = {
    expectedBindingToken: string | undefined;
    expectedRoot: string;
    expectedRelativePath: string;
    expectedRevision: string;
    expectedUpdatedRevision: string | undefined;
};

type ApplyResult = {
    success: boolean;
    identityMismatch: boolean;
    revisionMismatch: boolean;
    error: string | undefined;
};

export async function sendOperationsToView(
    viewProcess: ChildProcess | undefined,
    operations: DocumentOperation[],
    expectations: ApplyExpectations,
): Promise<ApplyResult> {
    if (!viewProcess) {
        return {
            success: false,
            identityMismatch: false,
            revisionMismatch: false,
            error: "No view process",
        };
    }

    const requestId = `apply_${++applyRequestCounter}`;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error("[AGENT] View process operation timeout");
            viewProcess.off("message", responseHandler);
            resolve({
                success: false,
                identityMismatch: false,
                revisionMismatch: false,
                error: "View process operation timeout",
            });
        }, 15000);

        const responseHandler = (message: Record<string, unknown>) => {
            if (
                message.type !== "operationsApplied" ||
                message.requestId !== requestId
            ) {
                return;
            }
            clearTimeout(timeout);
            viewProcess.off("message", responseHandler);
            resolve({
                success: message.success === true,
                identityMismatch: message.identityMismatch === true,
                revisionMismatch: message.revisionMismatch === true,
                error:
                    typeof message.error === "string"
                        ? message.error
                        : undefined,
            });
        };

        viewProcess.on("message", responseHandler);
        viewProcess.send({
            type: "applyLLMOperations",
            requestId,
            operations,
            timestamp: Date.now(),
            ...expectations,
        });
    });
}

type ViewDocumentContentResponse = {
    content: string;
    bindingToken: string | null;
    revision: string | null;
    identityMismatch: boolean;
    error: string | undefined;
};

type ReadExpectations = {
    expectedBindingToken: string | undefined;
    expectedRoot: string | undefined;
    expectedRelativePath: string | undefined;
};

let getContentRequestCounter = 0;

export async function getDocumentContentFromView(
    viewProcess: ChildProcess,
    expectations: ReadExpectations,
): Promise<ViewDocumentContentResponse> {
    const requestId = `get_${++getContentRequestCounter}`;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            viewProcess.off("message", responseHandler);
            reject(new Error("View process content request timed out"));
        }, 15000);

        const responseHandler = (message: Record<string, unknown>) => {
            if (
                message.type !== "documentContent" ||
                message.requestId !== requestId
            ) {
                return;
            }
            clearTimeout(timeout);
            viewProcess.off("message", responseHandler);
            resolve({
                content:
                    typeof message.content === "string" ? message.content : "",
                bindingToken:
                    typeof message.bindingToken === "string"
                        ? message.bindingToken
                        : null,
                revision:
                    typeof message.revision === "string"
                        ? message.revision
                        : null,
                identityMismatch: message.identityMismatch === true,
                error:
                    typeof message.error === "string"
                        ? message.error
                        : undefined,
            });
        };

        viewProcess.on("message", responseHandler);
        viewProcess.send({
            type: "getDocumentContent",
            requestId,
            ...expectations,
        });
    });
}

async function createViewServiceHost(
    filePath: string,
    port: number,
): Promise<{ process: ChildProcess; port: number } | undefined> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            console.log("Markdown view service creation timed out");
            reject(new Error("Markdown view service creation timed out"));
        }, 10000);
    });

    const viewServicePromise = new Promise<
        { process: ChildProcess; port: number } | undefined
    >((resolve, reject) => {
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
                workspaceRoot: folderPath,
                relativePath: path.basename(filePath),
            });

            childProcess.on("message", function (message: any) {
                if (message?.type === "Success") {
                    resolve({ process: childProcess, port: message.port });
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
    });

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}

// Global process message handler for UI commands
let currentAgentContext: MarkdownActionContext | null = null;
const wiredViewProcesses = new WeakSet<ChildProcess>();

// Store agent context for UI command processing
export function setCurrentAgentContext(context: MarkdownActionContext) {
    currentAgentContext = context;

    const viewProcess = context.viewProcess;

    if (
        typeof viewProcess !== "undefined" &&
        viewProcess.on &&
        !wiredViewProcesses.has(viewProcess)
    ) {
        wiredViewProcesses.add(viewProcess);
        viewProcess.on("message", async (message: any) => {
            if (
                message.type === "bindingUpdated" &&
                currentAgentContext?.currentDocument?.source === "session"
            ) {
                const binding = currentAgentContext.currentDocument.binding;
                if (
                    binding &&
                    message.boundRoot === binding.root &&
                    message.boundRelativePath === binding.relativePath &&
                    message.boundFilePath === binding.filePath
                ) {
                    currentAgentContext.currentBindingToken =
                        typeof message.bindingToken === "string"
                            ? message.bindingToken
                            : undefined;
                }
            } else if (message.type === "uiCommand" && currentAgentContext) {
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
