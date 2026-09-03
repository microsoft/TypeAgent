// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { MarkdownAction } from "./markdownActionSchema.js";
import { DocumentOperation } from "./markdownOperationSchema.js";
import { createMarkdownAgent } from "./translator.js";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { UICommandResult } from "./ipcTypes.js";
import { applyDocumentOperations } from "./documentOperations.js";
import { computeContentRevision } from "./contentRevision.js";
import {
    isCanonicalDirectory,
    normalizeRelativeDocumentPath,
    resolveExistingFileWithinRoot,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "./pathPolicy.js";
import { evaluateBoundPathAdoption } from "./boundPathAdoption.js";
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
    const result = await handleMarkdownAction(
        action as MarkdownAction,
        context,
    );
    return result;
}

type MarkdownActionContext = {
    // Relative name of the active document, used for activity state.
    currentFileName?: string | undefined;
    // Absolute path resolved beneath the host-authorized working directory.
    currentFilePath?: string | undefined;
    // Canonical workspace root used to revalidate direct file access.
    currentWorkspaceRoot?: string | undefined;
    // Opaque token the view service rotates on every trusted rebinding
    // (setFile from this agent, or /api/switch-document from the browser).
    // Attached to every read/apply IPC so a rebound view rejects requests
    // pinned to an older binding, including rebinding to the same relative
    // path.
    currentBindingToken?: string | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
    // Handle returned by sessionContext.registerPort for the markdown
    // preview / Yjs WebSocket server. Released on
    // updateMarkdownContext(false, ...).
    viewPortRegistration?: { release: () => void } | undefined;
};

// In-memory set of canonical workspace roots the host authorized in this
// process (via ActionContext.workingDirectory on create/openDocument).
// Recovery via adoptBoundPathFromView requires the view-reported root to
// exist in this set (or to canonicalize to the same value as the current
// ActionContext.workingDirectory). No persistence: session storage is
// intentionally not consulted, and a UI-synthesized ActionContext without
// a workingDirectory can never widen the trust boundary on its own.
const authorizedWorkspaceRoots = new Set<string>();

function authorizeWorkspaceRoot(canonicalRoot: string): void {
    authorizedWorkspaceRoots.add(canonicalRoot);
}

function isAuthorizedWorkspaceRoot(canonicalRoot: string): boolean {
    return authorizedWorkspaceRoots.has(canonicalRoot);
}

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
        // Store agent context for UI command processing. Markdown documents
        // are persisted under the host-authorized workingDirectory that
        // create/openDocument validates, not session storage; this call
        // deliberately does not seed a placeholder file so the view is
        // never rooted in the conversation sandbox.
        setCurrentAgentContext(context.agentContext);

        debug(
            `Agent context enabled, port: ${context.agentContext.localHostPort}`,
        );

        if (!context.agentContext.viewProcess) {
            // Fork the express view service in the background instead of
            // blocking agent enable (and therefore agent-server startup)
            // on it. The view starts in memory-only mode; create/openDocument
            // reroots it via setFile once the user picks a workspace file.
            // Every action handler guards on `viewProcess` presence, so
            // early actions simply skip the view until it's ready.
            void createViewServiceHost(context.agentContext.localHostPort)
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
                    // If create/openDocument already ran while the fork was
                    // in flight, replay the setFile so the freshly-forked
                    // view binds to the file the agent believes is current.
                    reconcileViewBinding(context.agentContext, viewProcess);
                    // Watch for binding rotations that originate in the view
                    // (browser-driven /api/switch-document, or the ack of
                    // this agent's setFile). This lets a later apply/read
                    // carry the freshest token as expectedBindingToken so
                    // the view can reject stale ones.
                    viewProcess.on("message", (message: any) => {
                        applyBindingUpdateFromView(
                            context.agentContext,
                            message,
                        );
                    });
                    // Defensive cleanup if the child crashes mid-session.
                    // The identity guard prevents a late-firing `exit`
                    // event on a previously-replaced process from
                    // clobbering a newer registration; the explicit
                    // disable path (which also releases) is naturally
                    // idempotent under `?.release()`.
                    viewProcess.once("exit", () => {
                        if (context.agentContext.viewProcess !== viewProcess) {
                            return;
                        }
                        context.agentContext.viewPortRegistration?.release();
                        context.agentContext.viewPortRegistration = undefined;
                        context.agentContext.viewProcess = undefined;
                    });
                    // Re-wire the UI-command message handler now that the
                    // view process exists (the earlier call below ran
                    // before it was forked).
                    setCurrentAgentContext(context.agentContext);
                })
                .catch((e) => {
                    console.warn(
                        "[AGENT] Markdown view service background start failed:",
                        e?.message ?? e,
                    );
                });
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

// Re-emit setFile to the freshly-forked view when create/openDocument
// finished ahead of the fork. Silently skipped when no file is bound yet.
export function reconcileViewBinding(
    agentContext: MarkdownActionContext,
    viewProcess: ChildProcess,
): void {
    const relativePath = agentContext.currentFileName;
    const workspaceRoot = agentContext.currentWorkspaceRoot;
    if (!relativePath || !workspaceRoot) {
        return;
    }
    viewProcess.send({
        type: "setFile",
        workspaceRoot,
        relativePath,
    });
    debug(
        `[AGENT] Reconciled view binding after fork: ${relativePath} under ${workspaceRoot}`,
    );
}

// Decision returned by shouldAdoptBindingUpdate. The rejection kinds are
// distinct so tests can assert on the reason without pattern-matching a
// human-readable message.
export type BindingUpdateDecision =
    | { kind: "ignore-non-binding" }
    | { kind: "ignore-missing-fields" }
    | { kind: "reject-path-mismatch" }
    | { kind: "reject-file-mismatch" }
    | { kind: "clear" }
    | { kind: "adopt"; bindingToken: string };

// Pure decision function for bindingUpdated messages. A bindingUpdated is
// only trustworthy when the reported bound root and relative path match
// what the agent already believes is current (canonical POSIX form). A
// browser-driven /api/switch-document that rotates the view onto a
// different document must NOT overwrite the agent's currentBindingToken,
// because the agent's currentFileName/currentWorkspaceRoot are still the
// old ones - adopting the new token here would let a subsequent
// applyLLMOperations sail through the identity check and write into the
// browser-selected file. Leaving the old token in place makes that apply
// fail identity closed and forces a fresh read/adopt cycle before any
// write. A rebinding to the same relative path (typical for our own
// setFile ack) still adopts, since the file identity is unchanged.
export function shouldAdoptBindingUpdate(
    agentContext: Pick<
        MarkdownActionContext,
        "currentFileName" | "currentWorkspaceRoot" | "currentFilePath"
    >,
    message: any,
): BindingUpdateDecision {
    if (!message || message.type !== "bindingUpdated") {
        return { kind: "ignore-non-binding" };
    }
    if (
        typeof message.boundRoot !== "string" ||
        typeof message.boundRelativePath !== "string" ||
        typeof message.boundFilePath !== "string"
    ) {
        // View reported that no file is bound (memory-only mode). Clear
        // the agent's cached token so a subsequent read carries no stale
        // token; leaving a stale token could match a later same-token
        // rebinding to a different file.
        if (
            message.bindingToken === null &&
            message.boundFilePath === null &&
            message.boundRoot === null &&
            message.boundRelativePath === null
        ) {
            return { kind: "clear" };
        }
        return { kind: "ignore-missing-fields" };
    }
    if (typeof message.bindingToken !== "string") {
        return { kind: "ignore-missing-fields" };
    }
    const expectedRoot = agentContext.currentWorkspaceRoot;
    const expectedRelative = agentContext.currentFileName;
    const expectedFilePath = agentContext.currentFilePath;
    if (!expectedRoot || !expectedRelative) {
        // Agent has no active document yet (e.g. bindingUpdated arrives
        // ahead of create/openDocument). Do not adopt: the agent has
        // nothing to pair the token with, and the browser-selected
        // binding must not silently become the agent's active document.
        return { kind: "reject-path-mismatch" };
    }
    if (
        message.boundRoot !== expectedRoot ||
        message.boundRelativePath !== expectedRelative
    ) {
        return { kind: "reject-path-mismatch" };
    }
    if (expectedFilePath && message.boundFilePath !== expectedFilePath) {
        return { kind: "reject-file-mismatch" };
    }
    return { kind: "adopt", bindingToken: message.bindingToken };
}

// Applies a bindingUpdated to the agent context using the pure decision
// function above. Returns the decision so callers/tests can observe it.
export function applyBindingUpdateFromView(
    agentContext: MarkdownActionContext,
    message: any,
): BindingUpdateDecision {
    const decision = shouldAdoptBindingUpdate(agentContext, message);
    switch (decision.kind) {
        case "adopt":
            agentContext.currentBindingToken = decision.bindingToken;
            debug(
                `[AGENT] Adopted view-reported bindingToken ${decision.bindingToken}`,
            );
            break;
        case "clear":
            agentContext.currentBindingToken = undefined;
            debug(
                "[AGENT] Cleared bindingToken after view reported memory-only mode",
            );
            break;
        case "reject-path-mismatch":
            debug(
                `[AGENT] Ignoring bindingUpdated: view reports ${
                    typeof message?.boundRelativePath === "string"
                        ? message.boundRelativePath
                        : "<none>"
                } under ${
                    typeof message?.boundRoot === "string"
                        ? message.boundRoot
                        : "<none>"
                } but agent expects ${agentContext.currentFileName ?? "<none>"} under ${agentContext.currentWorkspaceRoot ?? "<none>"}`,
            );
            break;
        case "reject-file-mismatch":
            debug(
                `[AGENT] Ignoring bindingUpdated: absolute boundFilePath differs from agent's currentFilePath`,
            );
            break;
        case "ignore-missing-fields":
        case "ignore-non-binding":
            break;
    }
    return decision;
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

    const agent = await createMarkdownAgent("GPT_4_O");

    // Read the current document. Prefer the view process (which has the
    // authoritative Yjs state) when it exists; otherwise pull directly from
    // the on-disk workspace document. Session storage is not a fallback.
    const {
        content: markdownContent,
        bindingToken,
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
                        markdownContent,
                        operations,
                        bindingToken,
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

/**
 * Read the current document content the LLM operates on. Prefers the view
 * process's live Yjs state; otherwise falls back to the on-disk absolute
 * `currentFilePath`. Session storage is intentionally not consulted here:
 * documents live under the host-authorized workingDirectory, not the
 * session-storage sandbox.
 *
 * Also carries the expected document identity through the IPC so that if
 * the view has been rebound (e.g. the browser switched files) since the
 * agent last observed the binding, the read reports the mismatch instead
 * of silently returning content from a different file.
 */
async function readCurrentDocumentContent(
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<{
    content: string;
    bindingToken: string | undefined;
    revision: string;
}> {
    const agentContext = actionContext.sessionContext.agentContext;
    if (!agentContext.currentFilePath && agentContext.viewProcess) {
        // Recovery path: the ActionContext synthesized for editor-originated
        // UI commands may lack workingDirectory. Adoption is gated by the
        // authorized-roots set so it never widens the trust boundary; when
        // no root can be justified the read fails closed below.
        await adoptBoundPathFromView(agentContext, actionContext);
    }
    const { root, relativeName } = getCurrentWorkspaceDocument(agentContext);
    const filePath = resolveExistingFileWithinRoot(root, relativeName);
    if (filePath === undefined) {
        throw new Error(
            "The current markdown document is no longer accessible within the authorized workspace",
        );
    }
    agentContext.currentFilePath = filePath;
    const expectedBindingToken = agentContext.currentBindingToken;
    if (agentContext.viewProcess) {
        // The view owns the authoritative Markdown state while it exists.
        // Any failure here (timeout, error) leaves us with no trustworthy
        // snapshot of what the browser is showing; silently falling back
        // to the on-disk file would let us read stale content while the
        // browser is showing something newer. Propagate the error and
        // let the caller decide (typically: fail the action).
        const response = await getDocumentContentFromView(
            agentContext.viewProcess,
            {
                expectedBindingToken,
                expectedRoot: root,
                expectedRelativePath: relativeName,
            },
        );
        if (response.identityMismatch) {
            throw new Error(
                `View is bound to a different document (expected token ${expectedBindingToken ?? "<none>"}, view reports ${response.bindingToken ?? "<none>"})`,
            );
        }
        if (typeof response.bindingToken === "string") {
            agentContext.currentBindingToken = response.bindingToken;
        }
        const revision =
            typeof response.revision === "string"
                ? response.revision
                : computeContentRevision(response.content);
        debug(
            `Got content from view process: ${response.content.length} chars (revision ${revision})`,
        );
        return {
            content: response.content,
            bindingToken: agentContext.currentBindingToken,
            revision,
        };
    }
    // Headless (no view) path. Read directly from the on-disk workspace
    // document. The path was already re-validated against the authorized
    // root above.
    const content = fs.readFileSync(filePath, "utf-8");
    const revision = computeContentRevision(content);
    debug(
        `Read document from filesystem: ${content.length} chars (revision ${revision})`,
    );
    return {
        content,
        bindingToken: agentContext.currentBindingToken,
        revision,
    };
}

// Recover the bound file/root from the view when the agent has none. The
// view responds with paths it already validated against its trusted root,
// but recovery still verifies that the reported root was authorized by
// the host (via a prior ActionContext.workingDirectory on create/open, or
// by the currently-supplied ActionContext) before adopting it. Anything
// else fails closed - the agent never adopts arbitrary child-reported
// authorization, and no session/conversation storage is consulted.
async function adoptBoundPathFromView(
    agentContext: MarkdownActionContext,
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<void> {
    const viewProcess = agentContext.viewProcess;
    if (!viewProcess) {
        return;
    }
    let response: ViewDocumentContentResponse;
    try {
        response = await getDocumentContentFromView(viewProcess);
    } catch (error) {
        debug(
            `[AGENT] Recovery from view failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        return;
    }
    const target = evaluateBoundPathAdoption(
        {
            boundFilePath: response.boundFilePath,
            boundRoot: response.boundRoot,
            boundRelativePath: response.boundRelativePath,
        },
        actionContext.workingDirectory,
        {
            resolveRealDirectory,
            resolveExistingFileWithinRoot,
            isAuthorizedRoot: isAuthorizedWorkspaceRoot,
            authorizeRoot: authorizeWorkspaceRoot,
        },
    );
    if (target === undefined) {
        debug(
            `[AGENT] Rejecting recovery: view-reported binding is not authorized in this process`,
        );
        return;
    }
    agentContext.currentWorkspaceRoot = target.canonicalRoot;
    agentContext.currentFileName = target.relativePath;
    agentContext.currentFilePath = target.resolvedAbsolute;
    if (typeof response.bindingToken === "string") {
        agentContext.currentBindingToken = response.bindingToken;
    }
    debug(
        `[AGENT] Adopted view-reported bound path: ${target.resolvedAbsolute} (root ${target.canonicalRoot}, relative ${target.relativePath})`,
    );
}

/**
 * Apply LLM operations and persist the result to the absolute on-disk
 * document path. Callers must only invoke this when there is no view
 * process. Otherwise the view process owns Yjs state and its autosave path
 * is authoritative. Throws when no currentFilePath is known, because
 * silently dropping the update would leave the user's edit in nowhere.
 */
async function persistOperationsToFile(
    actionContext: ActionContext<MarkdownActionContext>,
    currentContent: string,
    operations: DocumentOperation[],
): Promise<void> {
    const agentContext = actionContext.sessionContext.agentContext;
    const { root, relativeName } = getCurrentWorkspaceDocument(agentContext);
    const filePath = resolveWritableFileWithinRoot(root, relativeName);
    if (filePath === undefined) {
        throw new Error(
            "The current markdown document is no longer writable within the authorized workspace",
        );
    }
    const updatedContent = applyDocumentOperations(currentContent, operations);
    fs.writeFileSync(filePath, updatedContent, "utf-8");
    agentContext.currentFilePath = filePath;
}

function getCurrentWorkspaceDocument(agentContext: MarkdownActionContext): {
    root: string;
    relativeName: string;
} {
    const root = agentContext.currentWorkspaceRoot;
    const relativeName = agentContext.currentFileName;
    if (!root || !relativeName || !agentContext.currentFilePath) {
        throw new Error(
            "No markdown document is open. Use createDocument or openDocument first.",
        );
    }
    if (!isCanonicalDirectory(root)) {
        throw new Error(
            "The authorized markdown workspace root is no longer accessible",
        );
    }
    return { root, relativeName };
}

/**
 * Build the loopback URL clients can click to open the document in the view
 * service. `relativeName` is the full normalized POSIX-style relative path
 * (including `.md`); the trailing `.md` is dropped and each remaining path
 * segment is percent-encoded so nested layouts like `docs/team/roadmap`
 * round-trip through the URL and back into the view's document router.
 * Returns `undefined` when the view process is not running or no valid
 * port has been negotiated yet, so callers can decide whether to include
 * a link at all rather than emitting a broken one.
 */
function buildDocumentLoopbackUrl(
    agentContext: MarkdownActionContext,
    relativeName: string,
): string | undefined {
    if (!agentContext.viewProcess) {
        return undefined;
    }
    const port = agentContext.localHostPort;
    if (!Number.isInteger(port) || port <= 0) {
        return undefined;
    }
    const withoutExt = relativeName.toLowerCase().endsWith(".md")
        ? relativeName.slice(0, -".md".length)
        : relativeName;
    const encoded = withoutExt
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return `http://127.0.0.1:${port}/document/${encoded}`;
}

async function handleCreateOrOpenDocument(
    action: MarkdownAction,
    actionContext: ActionContext<MarkdownActionContext>,
): Promise<ActionResult> {
    const parameters = action.parameters as {
        name?: string;
        content?: string;
    };
    const rawName = parameters.name;
    if (!rawName) {
        return createActionResult(
            "Document could not be created: no name was provided",
        );
    }

    const relativeCandidate = normalizeRelativeDocumentPath(rawName);
    if (relativeCandidate === undefined) {
        throw new Error(
            `Document name is not a safe relative path: ${JSON.stringify(rawName)}`,
        );
    }
    const relativeName = relativeCandidate.toLowerCase().endsWith(".md")
        ? relativeCandidate
        : `${relativeCandidate}.md`;

    const agentContext = actionContext.sessionContext.agentContext;
    const workingDirectory = actionContext.workingDirectory;
    if (workingDirectory === undefined) {
        throw new Error(
            "Markdown document actions require a host-authorized working directory",
        );
    }
    const canonicalRoot = resolveRealDirectory(workingDirectory);
    if (canonicalRoot === undefined) {
        throw new Error(
            `Configured workingDirectory is not a real directory: ${workingDirectory}`,
        );
    }
    const absoluteFilePath = resolveWritableFileWithinRoot(
        canonicalRoot,
        relativeName,
        { createSubdirs: true },
    );
    if (absoluteFilePath === undefined) {
        throw new Error(
            `Document name escapes workingDirectory: ${JSON.stringify(rawName)}`,
        );
    }

    const initialContent =
        action.actionName === "createDocument"
            ? (parameters.content ?? "")
            : "";

    const documentExisted = fs.existsSync(absoluteFilePath);
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

    agentContext.currentFileName = relativeName;
    agentContext.currentFilePath = absoluteFilePath;
    agentContext.currentWorkspaceRoot = canonicalRoot;

    // Record the canonical workspace root as host-authorized so recovery
    // via adoptBoundPathFromView can later adopt the same-root binding
    // without persisting arbitrary child-reported values.
    authorizeWorkspaceRoot(canonicalRoot);

    if (agentContext.viewProcess) {
        agentContext.viewProcess.send({
            type: "setFile",
            workspaceRoot: canonicalRoot,
            relativePath: relativeName,
        });
    }

    const actionLabel = documentExisted ? "opened" : "created";
    const loopbackUrl = buildDocumentLoopbackUrl(agentContext, relativeName);

    const displayLines: string[] = [];
    displayLines.push(`Document ${actionLabel}: ${relativeName}`);
    if (loopbackUrl) {
        displayLines.push("", `[Open document](${loopbackUrl})`);
    }
    displayLines.push("");
    displayLines.push(`Path: \`${absoluteFilePath}\``);

    const result = createActionResultFromMarkdownDisplay(
        displayLines.join("\n"),
        `Document ${actionLabel} at ${absoluteFilePath}`,
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
        openLocalView: true,
    };
    return result;
}

type DocumentUpdateAction = Extract<
    MarkdownAction,
    { actionName: "updateDocument" | "streamingUpdateDocument" }
>;

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
    const {
        content: markdownContent,
        bindingToken,
        revision,
    } = await readCurrentDocumentContent(actionContext);
    const response = await agent.updateDocument(
        markdownContent,
        action.parameters.originalRequest,
        action.parameters.cursorPosition,
        parseEditorContext(action.parameters.context),
    );

    if (!response.success) {
        const errorMessage =
            (response as { message?: string }).message ??
            "Unknown error occurred";
        console.error("Translation failed:", errorMessage);
        return createActionResult(`Failed to update document: ${errorMessage}`);
    }

    const updateResult = response.data;
    if (updateResult.operations?.length) {
        await applyOperationsForCurrentDocument(
            actionContext,
            markdownContent,
            updateResult.operations,
            bindingToken,
            revision,
        );
    } else {
        debug("[AGENT] No operations returned from LLM");
    }

    return createActionResult(
        updateResult.operationSummary ?? "Updated document",
    );
}

async function applyOperationsForCurrentDocument(
    actionContext: ActionContext<MarkdownActionContext>,
    baseContent: string,
    operations: DocumentOperation[],
    bindingToken: string | undefined,
    revision: string,
    expectedUpdatedRevision?: string,
): Promise<void> {
    const agentContext = actionContext.sessionContext.agentContext;
    if (!agentContext.viewProcess) {
        await persistOperationsToFile(actionContext, baseContent, operations);
        debug("Applied operations directly to filesystem document");
        return;
    }

    const applied = await sendOperationsToView(
        agentContext.viewProcess,
        operations,
        {
            expectedBindingToken: bindingToken,
            expectedRoot: agentContext.currentWorkspaceRoot,
            expectedRelativePath: agentContext.currentFileName,
            expectedRevision: revision,
            expectedUpdatedRevision,
        },
    );
    if (applied.success) {
        debug("Operations applied successfully via view process");
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
        const agent = await createMarkdownAgent("GPT_4_O");
        agent.tokenUsage = tokenUsage;
        return agent;
    };

    switch (action.actionName) {
        case "openDocument":
        case "createDocument": {
            result = await handleCreateOrOpenDocument(action, actionContext);
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

/**
 * Send operations to view process for application (Flow 1 implementation)
 */
let applyRequestCounter = 0;

type ApplyResult = {
    success: boolean;
    identityMismatch: boolean;
    revisionMismatch: boolean;
    error?: string;
};

type ApplyExpectations = {
    expectedBindingToken?: string | undefined;
    expectedRoot?: string | undefined;
    expectedRelativePath?: string | undefined;
    expectedRevision?: string | undefined;
    expectedUpdatedRevision?: string | undefined;
};

async function sendOperationsToView(
    viewProcess: ChildProcess | undefined,
    operations: DocumentOperation[],
    expectations: ApplyExpectations,
): Promise<ApplyResult> {
    const {
        expectedBindingToken,
        expectedRoot,
        expectedRelativePath,
        expectedRevision,
        expectedUpdatedRevision,
    } = expectations;
    if (!viewProcess) {
        return {
            success: false,
            identityMismatch: false,
            revisionMismatch: false,
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
            });
        }, 15000);

        // Only accept the response tagged with our requestId. This keeps
        // out-of-order or concurrent operationsApplied messages from
        // resolving the wrong promise.
        const responseHandler = (message: any) => {
            if (
                message.type !== "operationsApplied" ||
                message.requestId !== requestId
            ) {
                return;
            }
            clearTimeout(timeout);
            viewProcess.off("message", responseHandler);

            if (message.success) {
                resolve({
                    success: true,
                    identityMismatch: false,
                    revisionMismatch: false,
                });
                return;
            }
            if (!message.identityMismatch && !message.revisionMismatch) {
                console.error(
                    "[AGENT] View failed to apply operations:",
                    message.error,
                );
            }
            resolve({
                success: false,
                identityMismatch: message.identityMismatch === true,
                revisionMismatch: message.revisionMismatch === true,
                error: message.error,
            });
        };

        viewProcess.on("message", responseHandler);

        viewProcess.send({
            type: "applyLLMOperations",
            requestId,
            operations,
            timestamp: Date.now(),
            expectedBindingToken,
            expectedRoot,
            expectedRelativePath,
            expectedRevision,
            expectedUpdatedRevision,
        });

        debug(
            `[AGENT] Sent ${operations.length} operations to view process (requestId ${requestId}, bindingToken ${expectedBindingToken ?? "-"})`,
        );
    });
}

/**
 * Get document content from view process (Flow 1 implementation)
 */
type ViewDocumentContentResponse = {
    content: string;
    boundDocumentId?: string;
    boundFilePath?: string | null;
    boundRoot?: string | null;
    boundRelativePath?: string | null;
    bindingToken?: string | null;
    revision?: string | null;
    identityMismatch: boolean;
    error?: string;
};

let getContentRequestCounter = 0;

type ReadExpectations = {
    expectedBindingToken?: string | undefined;
    expectedRoot?: string | undefined;
    expectedRelativePath?: string | undefined;
};

async function getDocumentContentFromView(
    viewProcess: ChildProcess,
    expectations: ReadExpectations = {},
): Promise<ViewDocumentContentResponse> {
    const { expectedBindingToken, expectedRoot, expectedRelativePath } =
        expectations;
    const requestId = `get_${++getContentRequestCounter}`;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            viewProcess.off("message", responseHandler);
            reject(new Error("View process content request timed out"));
        }, 15000); // 15 second timeout

        // Only accept the documentContent tagged with our requestId. This
        // is what lets multiple in-flight reads (or concurrent apply
        // acknowledgements) coexist without cross-talk.
        const responseHandler = (message: any) => {
            if (
                message.type !== "documentContent" ||
                message.requestId !== requestId
            ) {
                return;
            }
            clearTimeout(timeout);
            viewProcess.off("message", responseHandler);

            const source = message.source || "unknown";
            debug(
                `[AGENT] Received document content (requestId ${requestId}) from ${source}: ${message.content?.length || 0} chars`,
            );

            if (message.error) {
                debug(`[AGENT] Content retrieval had error: ${message.error}`);
            }

            resolve({
                content: message.content || "",
                boundDocumentId: message.boundDocumentId,
                boundFilePath: message.boundFilePath ?? null,
                boundRoot: message.boundRoot ?? null,
                boundRelativePath: message.boundRelativePath ?? null,
                bindingToken: message.bindingToken ?? null,
                revision: message.revision ?? null,
                identityMismatch: message.identityMismatch === true,
                error: message.error,
            });
        };

        viewProcess.on("message", responseHandler);

        debug(
            `[AGENT] Sending getDocumentContent request to view process (requestId ${requestId}, bindingToken ${expectedBindingToken ?? "-"})`,
        );
        viewProcess.send({
            type: "getDocumentContent",
            requestId,
            expectedBindingToken,
            expectedRoot,
            expectedRelativePath,
        });
    });
}
// NOTE: Function commented out per Flow 1 consolidation
// Collaboration server now managed by view process

// Fork the view service. The service starts in memory-only mode (no file
// bound); the agent later reroots it via setFile once the user runs
// create/openDocument. Passing no TYPEAGENT_MARKDOWN_ROOT lets the service
// use its own default until the trusted parent IPC picks a real workspace.
async function createViewServiceHost(
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
    >((resolve) => {
        try {
            const expressService = fileURLToPath(
                new URL(
                    path.join("..", "./view/route/service.js"),
                    import.meta.url,
                ),
            );

            const childProcess = fork(expressService, [port.toString()], {
                env: {
                    ...process.env,
                },
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
