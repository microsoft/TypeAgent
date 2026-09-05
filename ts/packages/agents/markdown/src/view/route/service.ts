// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { CollaborationManager } from "./collaborationManager.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import { Awareness } from "y-protocols/awareness";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import registerDebug from "debug";
import sanitizeFilename from "sanitize-filename";
import { randomUUID } from "node:crypto";
import { isAllowedViewOrigin } from "./originAllowlist.js";
import {
    normalizeRelativeDocumentPath,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "../../agent/pathPolicy.js";
import {
    computeContentRevision,
    persistDocumentOperations,
    readBoundDocument,
    type DocumentBinding,
} from "../../agent/documentUpdatePersistence.js";
import { applyDocumentOperations } from "../../agent/documentOperations.js";
import type { DocumentOperation } from "../../agent/markdownOperationSchema.js";

const debug = registerDebug("typeagent:markdown:service");

class ClientBindingMismatchError extends Error {}

const app: Express = express();
const LOOPBACK_HOST = "127.0.0.1";
const port = parseInt(process.argv[2]);
if (isNaN(port)) {
    throw new Error("Port must be a number");
}
let boundPort = port;

// Origin allowlist — runs before everything else so non-loopback
// requests get HTTP 403 without consuming rate-limit budget or hitting
// the route handlers. The server binds to localhost, but any local
// browser tab can still hit `http://localhost:<port>` via fetch/XHR;
// the gate stops cross-origin reads of the live document and uploaded
// files. The Y.js WebSocket upgrade is gated separately in
// createYjsWSServer.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isAllowedViewOrigin(origin)) {
        next();
        return;
    }
    debug(`Rejecting request from origin ${origin}`);
    res.status(403).send("Origin not allowed");
});
const limiter = rateLimit({
    windowMs: 60000,
    max: 100, // limit each IP to 100 requests per windowMs
});

// Serve static content from built directory
const staticPath = fileURLToPath(
    new URL("../../../dist/view/site", import.meta.url),
);

app.use(limiter);

// Root route - default document
app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

// Document-specific route, including nested relative paths.
app.get(/^\/document\/.+/, (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

// API endpoint to get current document name from URL
app.get("/api/current-document", (req: Request, res: Response) => {
    res.json({
        currentDocument: filePath ? path.basename(filePath, ".md") : null,
        relativePath: boundRelativePath,
        boundRelativePath,
    });
});

// API endpoint to switch to a specific document
app.post(
    "/api/switch-document",
    express.json(),
    (req: Request, res: Response) => {
        try {
            const rawPath =
                typeof req.body?.documentPath === "string"
                    ? req.body.documentPath
                    : req.body?.documentName;
            const normalized = normalizeRelativeDocumentPath(rawPath);
            if (normalized === undefined) {
                res.status(400).json({
                    error: "Invalid document path",
                });
                return;
            }
            const relativePath = normalized.toLowerCase().endsWith(".md")
                ? normalized
                : `${normalized}.md`;
            let safeDocumentPath = resolveWritableFileWithinRoot(
                getValidatedCurrentRoot(),
                relativePath,
            );
            if (safeDocumentPath === undefined) {
                res.status(403).json({
                    error: "Access to the specified path is forbidden.",
                });
                return;
            }

            if (!fs.existsSync(safeDocumentPath)) {
                const leafName = relativePath
                    .slice(0, -".md".length)
                    .split("/")
                    .pop() as string;
                const displayName = sanitizeFilename(leafName) || leafName;
                fs.writeFileSync(
                    safeDocumentPath,
                    `# ${displayName}\n\nThis is a new document.\n`,
                    { flag: "wx" },
                );
                safeDocumentPath = fs.realpathSync(safeDocumentPath);
            }

            const previousDocumentId = getCurrentDocumentId();
            const sameBinding =
                filePath === safeDocumentPath &&
                boundRelativePath === relativePath &&
                bindingToken !== null;
            const oldFilePath = filePath;
            filePath = safeDocumentPath;
            boundRelativePath = relativePath;
            if (!sameBinding) {
                bindingToken = randomUUID();
            }
            notifyBindingToParent();

            const documentId = getCurrentDocumentId();
            if (!sameBinding && previousDocumentId !== documentId) {
                evictRoomIfIdle(previousDocumentId);
            }
            const ydoc = getAuthoritativeDocument(documentId);
            const ytext = ydoc.getText("content");
            const content = sameBinding
                ? ytext.toString()
                : fs.readFileSync(safeDocumentPath, "utf-8");
            if (!sameBinding) {
                ytext.delete(0, ytext.length);
                ytext.insert(0, content);
            }
            const revision = computeContentRevision(
                fs.readFileSync(safeDocumentPath, "utf-8"),
            );

            if (oldFilePath !== filePath) {
                broadcastEvent({
                    type: "documentChanged",
                    newDocumentId: documentId,
                    newDocumentName: path.basename(relativePath, ".md"),
                    bindingToken,
                    boundRelativePath,
                    revision,
                    timestamp: Date.now(),
                });
            }

            res.json({
                success: true,
                documentName: path.basename(relativePath, ".md"),
                documentId,
                relativePath,
                boundRelativePath,
                bindingToken,
                content,
                revision,
                documentPath: safeDocumentPath,
            });
        } catch (error) {
            res.status(500).json({
                error: "Failed to switch document",
                details: error,
            });
        }
    },
);

// API endpoint to handle markdown response from clients
app.post(
    "/api/markdown-response",
    express.json(),
    (req: Request, res: Response) => {
        try {
            const { requestId, markdown, positionInfo, error } = req.body;
            const responseToken =
                typeof req.body?.bindingToken === "string"
                    ? req.body.bindingToken
                    : null;

            if (!requestId) {
                res.status(400).json({ error: "Request ID is required" });
                return;
            }

            debug(
                `[MARKDOWN-RESPONSE] Received response for request: ${requestId}, markdown length: ${markdown?.length || 0}, error: ${error || "none"}`,
            );

            // Find the pending markdown request
            const pendingRequest = pendingMarkdownRequests.get(requestId);
            if (pendingRequest) {
                clearTimeout(pendingRequest.timeout);
                pendingMarkdownRequests.delete(requestId);

                if (error) {
                    pendingRequest.reject(new Error(error));
                } else if (
                    pendingRequest.expectedBindingToken !== null &&
                    responseToken !== pendingRequest.expectedBindingToken
                ) {
                    pendingRequest.reject(
                        new ClientBindingMismatchError(
                            "Client markdown response binding token changed",
                        ),
                    );
                } else {
                    pendingRequest.resolve({
                        markdown: markdown || "",
                        positionInfo: positionInfo || { position: 0 },
                    });
                }

                debug(`[MARKDOWN-RESPONSE] Resolved request: ${requestId}`);
            } else {
                debug(
                    `[MARKDOWN-RESPONSE] No pending request found for: ${requestId}`,
                );
            }

            res.json({ success: true });
        } catch (error) {
            console.error(
                "[MARKDOWN-RESPONSE] Error handling response:",
                error,
            );
            res.status(500).json({
                error: "Failed to handle markdown response",
                details: error instanceof Error ? error.message : error,
            });
        }
    },
);

let clients: any[] = [];
let filePath: string | null = null;
let boundRelativePath: string | null = null;
let bindingToken: string | null = null;
const collaborationManager = new CollaborationManager();

// UI Command routing state
let commandCounter = 0;
const pendingCommands = new Map<string, any>();

// Markdown request state
let markdownRequestCounter = 0;
type PendingMarkdownRequest = {
    resolve: (value: {
        markdown: string;
        positionInfo: {
            position: number;
            selection?: { from: number; to: number };
        };
    }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    expectedBindingToken: string | null;
};
const pendingMarkdownRequests = new Map<string, PendingMarkdownRequest>();
const activeApplyBindings = new Set<string>();
const userHomeDir = os.homedir();
const INITIAL_ROOT_DIR =
    process.env.TYPEAGENT_MARKDOWN_ROOT || path.join(userHomeDir, "Documents");
let currentRoot =
    resolveRealDirectory(INITIAL_ROOT_DIR) ?? path.resolve(INITIAL_ROOT_DIR);

function resolveCanonicalRoot(root: string): string | undefined {
    const canonicalRoot = resolveRealDirectory(root);
    return canonicalRoot !== undefined &&
        path.relative(path.resolve(root), canonicalRoot) === ""
        ? canonicalRoot
        : undefined;
}

function getValidatedCurrentRoot(): string {
    if (resolveCanonicalRoot(currentRoot) === undefined) {
        throw new Error("The document root is no longer accessible");
    }
    return currentRoot;
}

type BindingSnapshot = {
    bindingToken: string | null;
    currentRoot: string;
    filePath: string | null;
    boundRelativePath: string | null;
};

function captureBindingSnapshot(): BindingSnapshot {
    return { bindingToken, currentRoot, filePath, boundRelativePath };
}

function bindingsDiffer(a: BindingSnapshot, b: BindingSnapshot): boolean {
    return (
        a.bindingToken !== b.bindingToken ||
        a.currentRoot !== b.currentRoot ||
        a.filePath !== b.filePath ||
        a.boundRelativePath !== b.boundRelativePath
    );
}

function bindingError(
    message: Record<string, unknown>,
    snapshot: BindingSnapshot,
): string | undefined {
    if (
        typeof message.expectedBindingToken === "string" &&
        message.expectedBindingToken !== snapshot.bindingToken
    ) {
        return "Document binding token changed";
    }
    if (
        typeof message.expectedRoot === "string" &&
        message.expectedRoot !== snapshot.currentRoot
    ) {
        return "Document binding root changed";
    }
    if (
        typeof message.expectedRelativePath === "string" &&
        message.expectedRelativePath !== snapshot.boundRelativePath
    ) {
        return "Document binding path changed";
    }
    return undefined;
}

function getCurrentDocumentId(
    snapshot: BindingSnapshot = captureBindingSnapshot(),
): string {
    return snapshot.filePath && snapshot.bindingToken
        ? snapshot.bindingToken
        : "default";
}

type BoundWriteValidation =
    | {
          ok: true;
          snapshot: BindingSnapshot;
          targetFilePath: string;
          targetDocumentId: string;
      }
    | {
          ok: false;
          status: number;
          error: string;
          revision?: string;
          content?: string;
      };

function validateBoundWriteRequest(body: {
    bindingToken?: unknown;
    expectedRevision?: unknown;
}): BoundWriteValidation {
    const snapshot = captureBindingSnapshot();
    if (!snapshot.filePath || !snapshot.boundRelativePath) {
        return {
            ok: false,
            status: 409,
            error: "No file is bound",
        };
    }
    if (
        snapshot.bindingToken === null ||
        body.bindingToken !== snapshot.bindingToken
    ) {
        return {
            ok: false,
            status: 409,
            error: "bindingToken is missing or stale",
        };
    }

    try {
        const document = readBoundDocument({
            token: snapshot.bindingToken,
            root: snapshot.currentRoot,
            relativePath: snapshot.boundRelativePath,
            filePath: snapshot.filePath,
        });
        if (
            typeof body.expectedRevision !== "string" ||
            body.expectedRevision !== document.revision
        ) {
            return {
                ok: false,
                status: 409,
                error:
                    typeof body.expectedRevision === "string"
                        ? "Document content changed since it was loaded"
                        : "expectedRevision is required",
                revision: document.revision,
                content: document.content,
            };
        }
        return {
            ok: true,
            snapshot,
            targetFilePath: document.filePath,
            targetDocumentId: getCurrentDocumentId(snapshot),
        };
    } catch (error) {
        return {
            ok: false,
            status: 403,
            error: error instanceof Error ? error.message : "Invalid binding",
        };
    }
}

function broadcastEvent(event: Record<string, unknown>): void {
    for (const client of clients) {
        try {
            client.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (error) {
            console.error("[SSE] Failed to send event:", error);
        }
    }
}

function getBoundRevision(): string | null {
    if (!filePath || !boundRelativePath) {
        return null;
    }
    try {
        return readBoundDocument({
            token: bindingToken ?? undefined,
            root: currentRoot,
            relativePath: boundRelativePath,
            filePath,
        }).revision;
    } catch (error) {
        debug(`Unable to read current binding revision: ${error}`);
        return null;
    }
}

function notifyBindingToParent(): void {
    process.send?.({
        type: "bindingUpdated",
        bindingToken,
        boundFilePath: filePath,
        boundRoot: filePath ? currentRoot : null,
        boundRelativePath,
    });
}

// Streaming state for LLM responses
const activeStreamingSessions = new Map<
    string,
    {
        response: Response;
        position: number;
        command: string;
    }
>();

// Utility function to safely write to response stream
function safeWriteToResponse(res: Response, data: string): boolean {
    try {
        if (res.writable && !res.writableEnded) {
            res.write(data);
            return true;
        }
        console.warn("Attempted to write to closed/ended response stream");
        return false;
    } catch (error) {
        console.error(" Error writing to response stream:", error);
        return false;
    }
}

// Utility function to safely end response stream
function safeEndResponse(res: Response): void {
    try {
        if (res.writable && !res.writableEnded) {
            res.end();
        }
    } catch (error) {
        console.error("Error ending response stream:", error);
    }
}

async function sendUICommandToAgent(
    command: string,
    parameters: any,
): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `ui_cmd_${++commandCounter}`;

        debug(
            `[VIEW] Sending UI command to agent: ${command}, requestId: ${requestId}, cursorPosition: ${parameters.context?.position}, context: ${parameters.context ? "serialized" : "none"}`,
        );

        const timeout = setTimeout(() => {
            pendingCommands.delete(requestId);
            debug(`[VIEW] Command ${requestId} timed out after 90 seconds`);
            reject(new Error("Agent command timeout"));
        }, 90000);

        // Store resolver for this request
        pendingCommands.set(requestId, { resolve, reject, timeout });

        // Send command to agent process (parent)

        process.send?.({
            type: "uiCommand",
            requestId: requestId,
            command: command,
            parameters: {
                originalRequest: parameters.originalRequest,
                context: parameters.context
                    ? JSON.stringify(parameters.context)
                    : undefined,
                cursorPosition: parameters.context?.position, // Explicit cursor position
            },
            timestamp: Date.now(),
        });
    });
}

/**
 * Send UI command to agent with streaming support
 */
async function sendUICommandToAgentWithStreaming(
    command: string,
    parameters: any,
    streamId: string,
): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `ui_cmd_${++commandCounter}`;

        debug(
            `[VIEW] Sending streaming UI command to agent: ${command}, requestId: ${requestId}, streamId: ${streamId}, cursorPosition: ${parameters.context?.position}, context: ${parameters.context ? "serialized" : "none"}`,
        );

        const timeout = setTimeout(() => {
            pendingCommands.delete(requestId);
            activeStreamingSessions.delete(streamId);
            debug(
                `[VIEW] Streaming command ${requestId} timed out after 240 seconds`,
            );
            reject(new Error("Agent command timeout"));
        }, 240000); // 240 second timeout for streaming LLM operations

        // Store resolver for this request
        pendingCommands.set(requestId, { resolve, reject, timeout, streamId });

        // Send command to agent process with streaming flag
        process.send?.({
            type: "uiCommand",
            requestId: requestId,
            command: command,
            parameters: {
                originalRequest: parameters.originalRequest,
                context: parameters.context
                    ? JSON.stringify(parameters.context)
                    : undefined,
                cursorPosition: parameters.context?.position, // Explicit cursor position
                streamId: streamId,
                enableStreaming: true,
            },
            timestamp: Date.now(),
        });
    });
}

/**
 * Request markdown content from connected client with retry logic
 */
async function requestMarkdownFromClient(
    retryCount: number = 0,
    snapshot: BindingSnapshot = captureBindingSnapshot(),
): Promise<{
    markdown: string;
    positionInfo: {
        position: number;
        selection?: { from: number; to: number };
    };
}> {
    const maxRetries = 3; // Increased from 2 to 3

    return new Promise((resolve, reject) => {
        const requestId = `markdown_req_${++markdownRequestCounter}`;
        const timeout = setTimeout(() => {
            pendingMarkdownRequests.delete(requestId);

            if (retryCount < maxRetries && clients.length > 0) {
                debug(
                    `[MARKDOWN-REQUEST] Timeout, retrying (${retryCount + 1}/${maxRetries})`,
                );
                // Retry after a longer delay for better reliability
                setTimeout(
                    () => {
                        requestMarkdownFromClient(retryCount + 1, snapshot)
                            .then(resolve)
                            .catch(reject);
                    },
                    2000 + retryCount * 1000,
                ); // Exponential backoff: 2s, 3s, 4s
            } else {
                reject(new Error("Client markdown request timeout"));
            }
        }, 8000); // 8 second timeout (increased from 5s)

        // Store resolver for this request
        pendingMarkdownRequests.set(requestId, {
            resolve,
            reject,
            timeout,
            expectedBindingToken: snapshot.bindingToken,
        });

        // Send request to clients via SSE
        debug(
            `[MARKDOWN-REQUEST] Sending request to clients: ${requestId} (attempt ${retryCount + 1})`,
        );

        if (clients.length === 0) {
            clearTimeout(timeout);
            pendingMarkdownRequests.delete(requestId);
            reject(new Error("No clients connected to provide markdown"));
            return;
        }

        // Send to primary client (first connected)
        const primaryClient = clients[0];
        try {
            primaryClient.write(
                `data: ${JSON.stringify({
                    type: "requestMarkdown",
                    requestId: requestId,
                    expectedBindingToken: snapshot.bindingToken,
                    expectedRelativePath: snapshot.boundRelativePath,
                    timestamp: Date.now(),
                })}\n\n`,
            );
            debug(
                `[MARKDOWN-REQUEST] Sent request to primary client: ${requestId}`,
            );
        } catch (error) {
            clearTimeout(timeout);
            pendingMarkdownRequests.delete(requestId);
            reject(
                new Error(
                    `Failed to send markdown request to client: ${error}`,
                ),
            );
        }
    });
}

void requestMarkdownFromClient;

/**
 * Determine if a command should use streaming
 */
function shouldCommandStream(originalRequest: string): boolean {
    if (!originalRequest) return false;

    const request = originalRequest.toLowerCase().trim();

    // Stream these commands for better UX
    // const streamingCommands = ["/continue"];
    const streamingCommands = ["/continue2"];

    // Don't stream these commands (need complete response)
    const nonStreamingCommands = ["/diagram", "/augment", "/test:diagram"];

    // Check non-streaming first (takes precedence)
    if (nonStreamingCommands.some((cmd) => request.startsWith(cmd))) {
        return false;
    }

    // Check streaming commands
    return streamingCommands.some((cmd) => request.startsWith(cmd));
}

/**
 * Handle streaming content chunk from agent
 */
function handleStreamingChunkFromAgent(
    streamId: string,
    chunk: string,
    isComplete: boolean = false,
): void {
    const session = activeStreamingSessions.get(streamId);
    if (!session) {
        console.warn(
            `[STREAM] No active session found for stream ID: ${streamId}`,
        );
        return;
    }

    const { response, position } = session;

    if (isComplete) {
        debug(`[STREAM] Streaming complete for session: ${streamId}`);
        // Don't send completion here - let the main handler do it
        return;
    }

    if (chunk) {
        debug(`[STREAM] Forwarding chunk to client`);

        // Forward chunk to client (similar to streamTestResponse)
        safeWriteToResponse(
            response,
            `data: ${JSON.stringify({
                type: "content",
                chunk: chunk,
                position: position,
            })}\n\n`,
        );
    }
}

// Get document as markdown text
app.get("/document", (req: Request, res: Response) => {
    if (!filePath) {
        debug(
            "[NO-FILE-MODE]  No file provided when resolving the /document call",
        );
        // Memory-only mode: get content from authoritative Y.js document
        const documentId = "default"; // Use consistent document ID

        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");
        const content = ytext.toString();
        res.setHeader("X-Content-Revision", computeContentRevision(content));

        debug(
            `Retrieved content from authoritative Y.js doc: ${documentId}, ${content.length} chars`,
        );
        res.send(content);
        return;
    }

    try {
        debug(
            "[FILE_MODE] File provided when resolving the /document call " +
                filePath,
        );

        const documentId = getCurrentDocumentId();
        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");
        const content = ytext.toString();
        const persistedContent = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, "utf-8")
            : "";
        res.setHeader(
            "X-Content-Revision",
            computeContentRevision(persistedContent),
        );

        debug(
            `Retrieved content from authoritative Y.js doc: ${documentId}, ${content.length} chars`,
        );

        res.send(content);
    } catch (error) {
        res.status(500).json({
            error: "Failed to load document",
            details: error,
        });
    }
});

// Save document from markdown text.
app.post("/document", express.json(), (req: Request, res: Response) => {
    const markdownContent =
        typeof req.body?.content === "string" ? req.body.content : "";

    if (!filePath) {
        const documentId = "default";
        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");
        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);
        res.json({
            success: true,
            message: "Content saved to memory (no file mode)",
        });

        return;
    }

    try {
        const validation = validateBoundWriteRequest(req.body ?? {});
        if (!validation.ok) {
            res.status(validation.status).json({
                error: validation.error,
                revision: validation.revision,
                content: validation.content,
            });
            return;
        }
        if (bindingsDiffer(captureBindingSnapshot(), validation.snapshot)) {
            res.status(409).json({ error: "Binding rotated during request" });
            return;
        }

        const ydoc = getAuthoritativeDocument(validation.targetDocumentId);
        const ytext = ydoc.getText("content");
        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);
        fs.writeFileSync(validation.targetFilePath, markdownContent, "utf-8");
        filePath = validation.targetFilePath;
        res.json({
            success: true,
            filePath: validation.targetFilePath,
            documentId: validation.targetDocumentId,
            revision: computeContentRevision(markdownContent),
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to save document",
            details: error,
        });
    }
});

// API endpoint to handle AI awareness requests
app.post("/api/ai-awareness", express.json(), (req: Request, res: Response) => {
    try {
        const { type, position, timestamp } = req.body;

        debug(`[AI-AWARENESS] Received request:`, req.body);

        if (!type) {
            res.status(400).json({ error: "AI awareness type is required" });
            return;
        }

        debug(
            `[AI-AWARENESS] Processing request: ${type}, position: ${position}, clients: ${clients.length}`,
        );

        // Broadcast AI awareness to all connected clients via SSE
        const awarenessData = {
            type: "aiAwareness",
            operation: type, // "showAICursor" or "hideAICursor"
            position: position,
            timestamp: timestamp || Date.now(),
        };

        debug(
            `[AI-AWARENESS] Broadcasting to ${clients.length} clients:`,
            awarenessData,
        );

        clients.forEach((client, index) => {
            try {
                client.write(`data: ${JSON.stringify(awarenessData)}\n\n`);
                debug(`[AI-AWARENESS] Sent ${type} to client ${index}`);
            } catch (error) {
                console.error(
                    `[AI-AWARENESS] Failed to send to client ${index}:`,
                    error,
                );
            }
        });

        const response = {
            success: true,
            message: `AI awareness ${type} broadcasted to ${clients.length} clients`,
            clientCount: clients.length,
        };

        debug(`[AI-AWARENESS] Sending response:`, response);
        res.json(response);
    } catch (error) {
        console.error("[AI-AWARENESS] Error handling request:", error);
        res.status(500).json({
            error: "Failed to handle AI awareness request",
            details: error instanceof Error ? error.message : error,
        });
    }
});

// Save browser content only when it still belongs to the active binding.
app.post("/autosave", express.json(), (req: Request, res: Response) => {
    try {
        const content =
            typeof req.body?.content === "string" ? req.body.content : null;
        if (content === null) {
            res.status(400).json({ error: "Content is required" });
            return;
        }

        const validation = validateBoundWriteRequest(req.body ?? {});
        if (!validation.ok) {
            res.status(validation.status).json({
                error: validation.error,
                revision: validation.revision,
                content: validation.content,
            });
            return;
        }
        if (bindingsDiffer(captureBindingSnapshot(), validation.snapshot)) {
            res.status(409).json({ error: "Binding rotated during request" });
            return;
        }

        const ydoc = getAuthoritativeDocument(validation.targetDocumentId);
        const ytext = ydoc.getText("content");
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
        fs.writeFileSync(validation.targetFilePath, content, "utf-8");
        const revision = computeContentRevision(content);
        broadcastEvent({
            type: "autoSave",
            filePath: validation.targetFilePath,
            documentId: validation.targetDocumentId,
            bindingToken: validation.snapshot.bindingToken,
            revision,
            contentLength: content.length,
            timestamp: Date.now(),
        });

        res.json({
            success: true,
            message: "Auto-saved successfully",
            filePath: validation.targetFilePath,
            documentId: validation.targetDocumentId,
            revision,
        });
    } catch (error) {
        console.error("[AUTO-SAVE] Auto-save failed:", error);

        // Notify clients of auto-save error
        clients.forEach((client) => {
            try {
                client.write(
                    `data: ${JSON.stringify({
                        type: "autoSaveError",
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                        timestamp: Date.now(),
                    })}\n\n`,
                );
            } catch (sseError) {
                console.error(
                    "[SSE] Failed to send auto-save error to client:",
                    sseError,
                );
            }
        });

        res.status(500).json({
            error: "Auto-save failed",
            details: error instanceof Error ? error.message : error,
        });
    }
});

// Add collaboration info endpoint
app.get("/collaboration/info", (req: Request, res: Response) => {
    const stats = collaborationManager.getStats();
    const currentDocumentName = filePath
        ? path.basename(filePath, ".md")
        : "default";
    const currentDocumentId = getCurrentDocumentId();

    debug(
        `[COLLAB-INFO] Returning collaboration info - currentDocument: "${currentDocumentName}", filePath: ${filePath}`,
    );

    res.json({
        ...stats,
        websocketServerUrl: `ws://${LOOPBACK_HOST}:${boundPort}`,
        currentDocument: currentDocumentName,
        currentDocumentName,
        currentDocumentId,
        boundRelativePath,
        bindingToken,
    });
});

app.get("/file/info", (req: Request, res: Response) => {
    if (!filePath) {
        res.status(404).json({ error: "No file loaded" });
        return;
    }

    try {
        const stats = fs.statSync(filePath);
        res.json({
            fileName: path.basename(filePath),
            fullPath: filePath,
            size: stats.size,
            modified: stats.mtime,
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to get file info",
            details: error,
        });
    }
});

// Add agent execution endpoint
app.post("/agent/execute", express.json(), (req: Request, res: Response) => {
    // Allow agent execution even without a file loaded - it can work with in-memory content
    try {
        const { action, parameters } = req.body;

        // Forward to the actual markdown agent
        forwardToMarkdownAgent(action, parameters)
            .then((result) => {
                res.json(result);
            })
            .catch((error) => {
                res.status(500).json({
                    error: "Agent execution failed",
                    details: error.message,
                });
            });
    } catch (error) {
        res.status(500).json({
            error: "Agent execution failed",
            details: error,
        });
    }
});

// Add streaming agent execution endpoint
app.post("/agent/stream", express.json(), (req: Request, res: Response) => {
    // Allow streaming even without a file loaded - useful for testing and new documents

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Add error handler for response stream
    res.on("error", (error) => {
        console.error(" [STREAM] Response stream error:", error);
    });

    res.on("close", () => {
        debug("[STREAM] Client disconnected");
    });

    try {
        const { action, parameters } = req.body;

        // Start streaming response with proper error handling
        streamAgentResponse(action, parameters, res).catch((error) => {
            console.error("[STREAM] Stream error caught:", error);

            // Only try to write if stream is still open
            if (
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({
                        type: "notification",
                        message: "AI service temporarily unavailable",
                        notificationType: "error",
                    })}\n\n`,
                )
            ) {
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`,
                );
            }

            safeEndResponse(res);
        });
    } catch (error) {
        console.error("[STREAM] Immediate error in /agent/stream:", error);

        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({
                type: "notification",
                message: "Failed to start AI processing",
                notificationType: "error",
            })}\n\n`,
        );

        safeEndResponse(res);
    }
});

async function streamAgentResponse(
    action: string,
    parameters: any,
    res: Response,
): Promise<void> {
    try {
        // Send start event
        if (
            !safeWriteToResponse(
                res,
                `data: ${JSON.stringify({ type: "start", message: "AI is thinking..." })}\n\n`,
            )
        ) {
            return; // Response stream is already closed
        }

        // Check if this is a test command
        if (parameters.originalRequest?.includes("/test:")) {
            await streamTestResponse(
                parameters.originalRequest,
                parameters.context,
                res,
            );
        } else {
            await streamRealAgentResponse(action, parameters, res);
        }

        // Send completion event only if stream is still open
        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({ type: "complete" })}\n\n`,
        );
        safeEndResponse(res);
    } catch (error) {
        console.error("[STREAM] Error in streamAgentResponse:", error);

        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

        // Try to send error message to user
        const errorData = JSON.stringify({
            type: "notification",
            message:
                "AI service temporarily unavailable. Please try again later.",
            notificationType: "error",
        });

        if (safeWriteToResponse(res, `data: ${errorData}\n\n`)) {
            safeWriteToResponse(
                res,
                `data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`,
            );
        }

        safeEndResponse(res);
    }
}

async function streamTestResponse(
    originalRequest: string,
    context: any,
    res: Response,
): Promise<void> {
    debug("🧪 Streaming test response for:", originalRequest);

    let content = "";
    let description = "";

    // Handle both /test:continue and /continue patterns
    if (originalRequest.includes("continue")) {
        content =
            "This is a test continuation of the document. The AI would normally analyze the context and generate appropriate content here. ";
        content +=
            "It would consider the preceding paragraphs, the overall document structure, and the intended audience to create relevant content. ";
        content +=
            "The response would be contextually aware and maintain consistent tone and style throughout.";
        description = "AI continuing document...";
    } else if (originalRequest.includes("diagram")) {
        // Extract description from either /test:diagram or /diagram format
        const diagramDesc =
            originalRequest.replace(/\/test:diagram|\/diagram/, "").trim() ||
            "test process";
        content = `\`\`\`mermaid\ngraph TD\n    A[Start: ${diagramDesc}] --> B{Process}\n    B --> C[Analysis]\n    C --> D[Decision]\n    D --> E[Implementation]\n    E --> F[End]\n\`\`\``;
        description = "AI generating diagram...";
    } else if (originalRequest.includes("augment")) {
        // Extract instruction from either /test:augment or /augment format
        const instruction =
            originalRequest.replace(/\/test:augment|\/augment/, "").trim() ||
            "improve formatting";

        // Check if equations are requested or use as enhanced default
        if (
            instruction.toLowerCase().includes("equation") ||
            instruction.toLowerCase().includes("maxwell") ||
            instruction === "improve formatting"
        ) {
            content = `> ✨ **Enhancement Applied**: ${instruction}`;
            content += `\n## Maxwell's Equations`;
            content += `\nJames Clerk Maxwell formulated a set of four partial differential equations that describe the behavior of electric and magnetic fields and their interactions with matter. These equations unified electricity, magnetism, and optics into a single theoretical framework.`;
            content += `\n### The Four Maxwell Equations`;
            content += `\n**Gauss's Law for Electricity:**`;
            content += `\n$$\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$$`;
            content += `\n**Gauss's Law for Magnetism:**`;
            content += `\n$$\\nabla \\cdot \\mathbf{B} = 0$$`;
            content += `\n**Faraday's Law of Induction:**`;
            content += `\n$$\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}$$`;
            content += `\n**Ampère's Circuital Law (with Maxwell's correction):**`;
            content += `\n$$\\nabla \\times \\mathbf{B} = \\mu_0\\mathbf{J} + \\mu_0\\varepsilon_0\\frac{\\partial \\mathbf{E}}{\\partial t}$$`;
            content += `\n### Historical Context`;
            content += `\nThese equations were developed by James Clerk Maxwell in the 1860s, building upon the experimental work of Michael Faraday, André-Marie Ampère, and Carl Friedrich Gauss. Maxwell's theoretical insight was the addition of the "displacement current" term, which predicted the existence of electromagnetic waves traveling at the speed of light.`;
            content += `\n![James Clerk Maxwell](https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/James_Clerk_Maxwell.png/256px-James_Clerk_Maxwell.png)`;
            content += `\n*James Clerk Maxwell (1831-1879), Scottish physicist and mathematician*`;
            content += `\n### Significance`;
            content += `\n- **Unified Theory**: Combined electricity, magnetism, and light into electromagnetic theory`;
            content += `\n- **Predicted Radio Waves**: Led to Heinrich Hertz's discovery of radio waves`;
            content += `\n- **Foundation for Modern Physics**: Influenced Einstein's special relativity theory`;
            content += `\n- **Technological Impact**: Enabled development of wireless communication, radar, and countless electronic devices`;
            description = "AI adding Maxwell's equations and background...";
        } else {
            // Original augment content for other instructions
            content = `\n> ✨ **Enhancement Applied**: ${instruction}\n\n`;
            content +=
                "This is a test augmentation of the document. The AI would normally analyze the content and apply the requested improvements.\n\n";
            content +=
                "**Potential improvements could include:**\n- Better formatting and structure\n- Enhanced readability\n- Additional context and examples\n- Improved flow and transitions";
            description = "AI enhancing document...";
        }
    } else {
        // Fallback for unknown commands
        content =
            "This is a test response for an unrecognized command. The AI system would normally process the specific request and generate appropriate content.";
        description = "AI processing request...";
    }

    // Send typing indicator
    if (
        !safeWriteToResponse(
            res,
            `data: ${JSON.stringify({ type: "typing", message: description })}\n\n`,
        )
    ) {
        return; // Response stream closed
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    // For enhanced content with equations, don't stream - just send final content
    const hasEquations = content.includes("Maxwell") || content.includes("$$");

    if (hasEquations) {
        // Send a message that we're generating complex content
        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({
                type: "content",
                chunk: "Generating mathematical content...",
                position: context?.position || 0,
            })}\n\n`,
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Send the markdown content as a special operation
        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({
                type: "operation",
                operation: {
                    type: "insertMarkdown",
                    position: context?.position || 0,
                    markdown: content,
                    description: description,
                },
            })}\n\n`,
        );
    } else {
        // Regular streaming for simple content
        const words = content.split(" ");
        let currentChunk = "";

        for (let i = 0; i < words.length; i++) {
            currentChunk += words[i] + " ";

            // Send chunk every 3-5 words for typing effect
            if (i % 4 === 0 || i === words.length - 1) {
                if (
                    !safeWriteToResponse(
                        res,
                        `data: ${JSON.stringify({
                            type: "content",
                            chunk: currentChunk,
                            position: context?.position || 0,
                        })}\n\n`,
                    )
                ) {
                    return; // Response stream closed
                }

                currentChunk = "";
                // Simulate typing delay
                await new Promise((resolve) =>
                    setTimeout(resolve, 150 + Math.random() * 100),
                );
            }
        }

        // Send final operation for simple content
        const operation = {
            type: "insert",
            position: context?.position || 0,
            content: [
                {
                    type: "paragraph",
                    content: [{ type: "text", text: content }],
                },
            ],
            description: description,
        };

        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({ type: "operation", operation })}\n\n`,
        );
    }

    // Send completion signal
    safeWriteToResponse(
        res,
        `data: ${JSON.stringify({ type: "complete" })}\n\n`,
    );
}

async function streamRealAgentResponse(
    action: string,
    parameters: any,
    res: Response,
): Promise<void> {
    debug("[VIEW] Routing LLM request to agent process:", action);

    try {
        // Determine if this command should stream
        const shouldStream = shouldCommandStream(parameters.originalRequest);

        if (shouldStream) {
            // Set up streaming session
            const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            activeStreamingSessions.set(streamId, {
                response: res,
                position: parameters.context?.position || 0,
                command: parameters.originalRequest,
            });

            debug(
                `[STREAM] Starting streaming session: ${streamId} for command: ${parameters.originalRequest}`,
            );

            // Send typing indicator
            if (
                !safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({ type: "typing", message: "AI is generating content..." })}\n\n`,
                )
            ) {
                return; // Response stream closed
            }

            // Route to agent process with streaming flag
            const result = await sendUICommandToAgentWithStreaming(
                action,
                parameters,
                streamId,
            );

            // Clean up streaming session
            activeStreamingSessions.delete(streamId);

            if (result.success) {
                // Send completion event
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({ type: "complete" })}\n\n`,
                );
            } else {
                // Send error notification
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({
                        type: "notification",
                        message: result.message || "AI command failed",
                        notificationType: "error",
                    })}\n\n`,
                );
            }
        } else {
            // Non-streaming command - use existing flow
            // Send typing indicator
            if (
                !safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({ type: "typing", message: "AI is processing..." })}\n\n`,
                )
            ) {
                return; // Response stream closed
            }

            // Route to agent process via IPC with timeout handling
            const result = await sendUICommandToAgent(action, parameters);

            if (result.success) {
                // Send success notification
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({
                        type: "notification",
                        message: result.message,
                        notificationType: "success",
                    })}\n\n`,
                );

                // Operations are already applied to Yjs by agent
                // Just notify frontend that changes are available
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({
                        type: "operationsApplied",
                        operationCount: result.operations?.length || 0,
                    })}\n\n`,
                );
            } else {
                // Send error notification for failed commands
                safeWriteToResponse(
                    res,
                    `data: ${JSON.stringify({
                        type: "notification",
                        message: result.message || "AI command failed",
                        notificationType: "error",
                    })}\n\n`,
                );
            }
        }
    } catch (error) {
        console.error("[VIEW] Failed to route to agent:", error);

        // Determine if this is a timeout error or other error
        const isTimeout =
            error instanceof Error && error.message.includes("timeout");
        const errorMessage = isTimeout
            ? "AI service is temporarily unavailable. Please try again in a moment."
            : "Failed to process AI command. Please try again.";

        // Send user-friendly error notification
        safeWriteToResponse(
            res,
            `data: ${JSON.stringify({
                type: "notification",
                message: errorMessage,
                notificationType: "error",
            })}\n\n`,
        );

        // If it's a timeout, provide a clear offline notification but don't generate content
        if (isTimeout && parameters.originalRequest) {
            debug(" [VIEW] Agent timeout, providing offline notification only");

            safeWriteToResponse(
                res,
                `data: ${JSON.stringify({
                    type: "notification",
                    message:
                        "AI agent is offline. Please try again when the service is available.",
                    notificationType: "warning",
                })}\n\n`,
            );
        }
    }
}

async function forwardToMarkdownAgent(
    action: string,
    parameters: any,
): Promise<any> {
    try {
        debug("[VIEW] Forwarding LLM request to agent process:", action);

        // Route to agent process instead of creating duplicate LLM service
        const result = await sendUICommandToAgent(action, parameters);

        if (result.success) {
            return {
                operations: result.operations || [],
                summary:
                    result.message ||
                    `Generated ${action} content successfully`,
                success: true,
            };
        } else {
            throw new Error(
                result.error || result.message || "Agent command failed",
            );
        }
    } catch (error) {
        console.error("[VIEW] Failed to route to agent:", error);

        // Fallback to test response for development
        if (parameters.originalRequest?.includes("/test:")) {
            return generateTestResponse(
                parameters.originalRequest,
                parameters.context,
            );
        }

        throw error;
    }
}

function generateTestResponse(originalRequest: string, context: any): any {
    debug("Generating test response for:", originalRequest);

    if (originalRequest.includes("/test:continue")) {
        return {
            operations: [
                {
                    type: "continue",
                    position: context?.position || 0,
                    content:
                        "This is a test continuation of the document. The AI would normally analyze the context and generate appropriate content here.",
                    style: "paragraph",
                    description: "Added test continuation",
                },
            ],
            summary: "Added test continuation content",
            success: true,
        };
    } else if (originalRequest.includes("/test:diagram")) {
        const description =
            originalRequest.replace("/test:diagram", "").trim() ||
            "test process";
        return {
            operations: [
                {
                    type: "diagram",
                    position: context?.position || 0,
                    diagramType: "mermaid",
                    content: `
erDiagram
          CUSTOMER }|..|{ DELIVERY-ADDRESS : has
          CUSTOMER ||--o{ ORDER : places
          CUSTOMER ||--o{ INVOICE : "liable for"
          DELIVERY-ADDRESS ||--o{ ORDER : receives
          INVOICE ||--|{ ORDER : covers
          ORDER ||--|{ ORDER-ITEM : includes
          PRODUCT-CATEGORY ||--|{ PRODUCT : contains
          PRODUCT ||--o{ ORDER-ITEM : "ordered in"
`,

                    description: `Generated test diagram for: ${description}`,
                },
            ],
            summary: `Generated test diagram`,
            success: true,
        };
    } else if (originalRequest.includes("/test:augment")) {
        const instruction =
            originalRequest.replace("/test:augment", "").trim() ||
            "improve formatting";
        return {
            operations: [
                {
                    type: "insert",
                    position: context?.position || 0,
                    content: [
                        `\n> ✨ **Enhancement Applied**: ${instruction}\n\nThis is a test augmentation of the document. The AI would normally analyze the content and apply the requested improvements.\n`,
                    ],
                    description: `Applied test augmentation: ${instruction}`,
                },
            ],
            summary: `Applied test augmentation: ${instruction}`,
            success: true,
        };
    }

    return {
        operations: [],
        summary: "Test command completed",
        success: true,
    };
}

app.get("/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);
    const clientRole = clients.length === 1 ? "primary" : "secondary";
    const revision = getBoundRevision();
    res.write(
        `data: ${JSON.stringify({
            type: "bindingBootstrap",
            bindingToken,
            documentId: filePath ? getCurrentDocumentId() : null,
            documentName: filePath ? path.basename(filePath, ".md") : null,
            boundRelativePath,
            revision,
            clientRole,
            timestamp: Date.now(),
        })}\n\n`,
    );

    req.on("close", () => {
        const wasPrimary = clients[0] === res;
        clients = clients.filter((client) => client !== res);
        if (wasPrimary && clients[0]) {
            safeWriteToResponse(
                clients[0],
                `data: ${JSON.stringify({
                    type: "primaryElected",
                    bindingToken,
                    revision: getBoundRevision(),
                    timestamp: Date.now(),
                })}\n\n`,
            );
        }
    });
});

// Serve static files AFTER API routes to avoid conflicts
app.use(express.static(staticPath));

process.on("message", async (message: any) => {
    debug(
        `[VIEW] Received IPC message: ${message.type} at ${new Date().toISOString()}`,
    );

    if (message.type == "setFile") {
        if (message.relativePath) {
            const nextRoot =
                typeof message.workspaceRoot === "string" &&
                resolveCanonicalRoot(message.workspaceRoot) !== undefined
                    ? resolveCanonicalRoot(message.workspaceRoot)
                    : undefined;
            const relativePath = normalizeRelativeDocumentPath(
                message.relativePath,
            );
            if (nextRoot === undefined || relativePath === undefined) {
                debug("Invalid document binding provided in message");
                return;
            }
            const resolvedFilePath = resolveWritableFileWithinRoot(
                nextRoot,
                relativePath,
            );
            if (resolvedFilePath === undefined) {
                debug("Invalid file path provided in message");
                return;
            }

            if (
                currentRoot === nextRoot &&
                filePath === resolvedFilePath &&
                boundRelativePath === relativePath &&
                bindingToken !== null
            ) {
                notifyBindingToParent();
                return;
            }

            const oldFilePath = filePath;
            const previousDocumentId = getCurrentDocumentId();
            currentRoot = nextRoot;
            filePath = resolvedFilePath;
            boundRelativePath = relativePath;
            bindingToken = randomUUID();
            notifyBindingToParent();

            const documentId = getCurrentDocumentId();
            if (previousDocumentId !== documentId) {
                evictRoomIfIdle(previousDocumentId);
            }

            // Get or create the authoritative Y.js document
            const ydoc = getAuthoritativeDocument(documentId);

            // Load existing content into the authoritative document
            if (fs.existsSync(resolvedFilePath)) {
                const content = fs.readFileSync(resolvedFilePath, "utf-8");

                // Set content directly in the authoritative Y.js document
                const ytext = ydoc.getText("content");
                ytext.delete(0, ytext.length); // Clear existing content
                ytext.insert(0, content); // Insert file content

                debug(
                    `File loaded into authoritative document: ${documentId}, ${content.length} chars from ${relativePath}`,
                );
            } else {
                debug(
                    `File doesn't exist, authoritative document ${documentId} remains empty`,
                );
            }

            // Notify frontend clients if the document has changed
            if (oldFilePath !== filePath) {
                broadcastEvent({
                    type: "documentChanged",
                    newDocumentId: documentId,
                    newDocumentName: path.basename(relativePath, ".md"),
                    bindingToken,
                    boundRelativePath,
                    revision: computeContentRevision(
                        ydoc.getText("content").toString(),
                    ),
                    timestamp: Date.now(),
                });
            }
        } else {
            const previousDocumentId = getCurrentDocumentId();
            // No file mode - initialize with default content using authoritative document
            filePath = null;
            boundRelativePath = null;
            bindingToken = null;
            notifyBindingToParent();
            debug("Running in memory-only mode (no file)");

            const documentId = "default";
            if (previousDocumentId !== documentId) {
                evictRoomIfIdle(previousDocumentId);
            }

            // Get or create authoritative Y.js document for memory-only mode
            const ydoc = getAuthoritativeDocument(documentId);

            // Set default content in the authoritative Y.js document
            const defaultContent = `# Welcome to AI-Enhanced Markdown Editor

Start editing your markdown document with AI assistance!

## Features

- **WYSIWYG Editing** with Milkdown Crepe
- **AI-Powered Tools** integrated with TypeAgent
- **Real-time Preview** with full markdown support
- **Mermaid Diagrams** with visual editing
- **Math Equations** with LaTeX support
- **GeoJSON Maps** for location data

## AI Commands

Try these AI-powered commands:

- Type \`/\` to open the block edit menu with AI tools
- Use **Continue Writing** to let AI continue writing
- Use **Generate Diagram** to create Mermaid diagrams
- Use **Augment Document** to improve the document
- Test versions available for testing without API calls

## Example Diagram

\`\`\`mermaid
graph TD
    A[Start Editing] --> B{Need AI Help?}
    B -->|Yes| C[Use / Commands]
    B -->|No| D[Continue Writing]
    C --> E[AI Generates Content]
    E --> F[Review & Edit]
    F --> G[Save Document]
    D --> G
\`\`\`

Start typing to see the editor in action!
`;

            const ytext = ydoc.getText("content");

            // Only set content if document is empty to avoid overwriting existing content
            if (ytext.length === 0) {
                ytext.insert(0, defaultContent);
                debug(
                    `Initialized authoritative Y.js document ${documentId} with default content: ${defaultContent.length} chars`,
                );
            } else {
                debug(
                    `Authoritative Y.js document ${documentId} already has content: ${ytext.length} chars`,
                );
            }
        }
    } else if (message.type == "applyOperations") {
        // Send operations to frontend
        debug(
            "View received IPC operations from agent:",
            message.operations?.length,
        );
        clients.forEach((client) => {
            client.write(
                `data: ${JSON.stringify({
                    type: "operations",
                    operations: message.operations,
                })}\n\n`,
            );
        });
    } else if (message.type === "applyLLMOperations") {
        const requestId =
            typeof message.requestId === "string" ? message.requestId : "";
        const snapshot = captureBindingSnapshot();
        let activeApplyKey: string | undefined;
        try {
            if (
                !Array.isArray(message.operations) ||
                !snapshot.filePath ||
                !snapshot.boundRelativePath
            ) {
                throw new Error("Invalid document update request");
            }
            const identityError = bindingError(message, snapshot);
            if (identityError) {
                process.send?.({
                    type: "operationsApplied",
                    requestId,
                    success: false,
                    identityMismatch: true,
                    error: identityError,
                    bindingToken: snapshot.bindingToken,
                });
                return;
            }
            if (typeof message.expectedRevision !== "string") {
                throw new Error("Invalid document update request");
            }
            activeApplyKey = snapshot.bindingToken ?? "memory";
            if (activeApplyBindings.has(activeApplyKey)) {
                throw new Error(
                    "Another document update is already in progress for this binding",
                );
            }
            activeApplyBindings.add(activeApplyKey);

            const binding: DocumentBinding = {
                token: snapshot.bindingToken ?? undefined,
                root: snapshot.currentRoot,
                relativePath: snapshot.boundRelativePath,
                filePath: snapshot.filePath,
            };
            const expected = {
                bindingToken:
                    typeof message.expectedBindingToken === "string"
                        ? message.expectedBindingToken
                        : undefined,
                root:
                    typeof message.expectedRoot === "string"
                        ? message.expectedRoot
                        : undefined,
                relativePath:
                    typeof message.expectedRelativePath === "string"
                        ? message.expectedRelativePath
                        : undefined,
                revision: message.expectedRevision,
                updatedRevision:
                    typeof message.expectedUpdatedRevision === "string"
                        ? message.expectedUpdatedRevision
                        : undefined,
            };
            let persisted;
            if (clients.length === 0) {
                persisted = persistDocumentOperations(
                    binding,
                    message.operations as DocumentOperation[],
                    expected,
                );
            } else {
                const persistedRevisionBeforeRead =
                    readBoundDocument(binding).revision;
                const response = await requestMarkdownFromClient(0, snapshot);
                if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
                    throw new Error("Document binding changed during read");
                }
                const baseRevision = computeContentRevision(response.markdown);
                const alreadyApplied =
                    expected.updatedRevision !== undefined &&
                    expected.updatedRevision === baseRevision;
                if (!alreadyApplied && expected.revision !== baseRevision) {
                    throw new Error(
                        "Document changed between read and apply (revision mismatch)",
                    );
                }
                const content = alreadyApplied
                    ? response.markdown
                    : applyDocumentOperations(
                          response.markdown,
                          message.operations as DocumentOperation[],
                      );
                const revision = computeContentRevision(content);
                if (
                    expected.updatedRevision !== undefined &&
                    expected.updatedRevision !== revision
                ) {
                    throw new Error(
                        "Updated document revision does not match operations",
                    );
                }
                const writableFilePath = resolveWritableFileWithinRoot(
                    snapshot.currentRoot,
                    snapshot.boundRelativePath,
                );
                if (
                    writableFilePath === undefined ||
                    path.relative(writableFilePath, snapshot.filePath) !== ""
                ) {
                    throw new Error("Document binding path changed");
                }
                if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
                    throw new Error("Document binding changed before write");
                }
                if (
                    readBoundDocument(binding).revision !==
                    persistedRevisionBeforeRead
                ) {
                    throw new Error(
                        "Document changed during browser read (revision mismatch)",
                    );
                }
                fs.writeFileSync(writableFilePath, content, "utf-8");
                persisted = {
                    content,
                    revision,
                    alreadyApplied,
                    filePath: writableFilePath,
                };
            }

            const documentId = getCurrentDocumentId(snapshot);
            collaborationManager.setDocumentContent(
                documentId,
                persisted.content,
            );
            if (snapshot.bindingToken) {
                broadcastEvent({
                    type: "documentSnapshot",
                    bindingToken: snapshot.bindingToken,
                    markdown: persisted.content,
                    revision: persisted.revision,
                    timestamp: Date.now(),
                });
            }
            process.send?.({
                type: "operationsApplied",
                requestId,
                success: true,
                operationCount: message.operations.length,
                bindingToken: snapshot.bindingToken,
                revision: persisted.revision,
            });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            process.send?.({
                type: "operationsApplied",
                requestId,
                success: false,
                identityMismatch:
                    error instanceof ClientBindingMismatchError ||
                    /binding|workspace root/.test(errorMessage),
                revisionMismatch: /revision mismatch/.test(errorMessage),
                error: errorMessage,
                bindingToken: snapshot.bindingToken,
            });
        } finally {
            if (activeApplyKey !== undefined) {
                activeApplyBindings.delete(activeApplyKey);
            }
        }
    } else if (message.type === "getDocumentContent") {
        const requestId =
            typeof message.requestId === "string" ? message.requestId : "";
        const snapshot = captureBindingSnapshot();
        try {
            const identityError = bindingError(message, snapshot);
            if (identityError) {
                process.send?.({
                    type: "documentContent",
                    requestId,
                    content: "",
                    source: "error",
                    error: identityError,
                    identityMismatch: true,
                    bindingToken: snapshot.bindingToken,
                    boundFilePath: snapshot.filePath,
                    boundRoot: snapshot.filePath ? snapshot.currentRoot : null,
                    boundRelativePath: snapshot.boundRelativePath,
                    revision: null,
                    timestamp: Date.now(),
                });
                return;
            }
            if (!snapshot.filePath || !snapshot.boundRelativePath) {
                throw new Error("No markdown document is bound");
            }
            let content: string;
            let source: "client-serializer" | "file-fallback";
            if (clients.length > 0) {
                try {
                    content = (await requestMarkdownFromClient(0, snapshot))
                        .markdown;
                    source = "client-serializer";
                } catch (error) {
                    if (error instanceof ClientBindingMismatchError) {
                        throw error;
                    }
                    const document = readBoundDocument({
                        token: snapshot.bindingToken ?? undefined,
                        root: snapshot.currentRoot,
                        relativePath: snapshot.boundRelativePath,
                        filePath: snapshot.filePath,
                    });
                    content = document.content;
                    source = "file-fallback";
                }
            } else {
                const document = readBoundDocument({
                    token: snapshot.bindingToken ?? undefined,
                    root: snapshot.currentRoot,
                    relativePath: snapshot.boundRelativePath,
                    filePath: snapshot.filePath,
                });
                content = document.content;
                source = "file-fallback";
            }
            if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
                throw new Error("Document binding changed during read");
            }
            process.send?.({
                type: "documentContent",
                requestId,
                content,
                source,
                bindingToken: snapshot.bindingToken,
                boundFilePath: snapshot.filePath,
                boundRoot: snapshot.currentRoot,
                boundRelativePath: snapshot.boundRelativePath,
                revision: computeContentRevision(content),
                timestamp: Date.now(),
            });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            process.send?.({
                type: "documentContent",
                requestId,
                content: "",
                source: "error",
                error: errorMessage,
                identityMismatch:
                    error instanceof ClientBindingMismatchError ||
                    /binding|workspace root/.test(errorMessage),
                bindingToken: snapshot.bindingToken,
                boundFilePath: snapshot.filePath,
                boundRoot: snapshot.filePath ? snapshot.currentRoot : null,
                boundRelativePath: snapshot.boundRelativePath,
                revision: null,
                timestamp: Date.now(),
            });
        }
    } else if (message.type === "uiCommandResult") {
        // Handle UI command results from agent
        debug(
            `[VIEW] Received uiCommandResult for ${message.requestId}, success: ${message.result?.success}`,
        );

        const pending = pendingCommands.get(message.requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            pendingCommands.delete(message.requestId);
            pending.resolve(message.result);
            debug(`[VIEW] Resolved pending command ${message.requestId}`);
        } else {
            debug(`[VIEW] No pending command found for ${message.requestId}`);
        }
    } else if (message.type === "streamingContent") {
        // Handle streaming content chunk from agent
        debug(
            `[VIEW] Received streaming content: streamId=${message.streamId}, chunk length=${message.chunk?.length || 0}`,
        );
        handleStreamingChunkFromAgent(
            message.streamId,
            message.chunk,
            message.isComplete,
        );
    } else if (message.type === "streamingComplete") {
        // Handle streaming completion from agent
        debug(
            `[VIEW] Received streaming completion: streamId=${message.streamId}`,
        );

        const session = activeStreamingSessions.get(message.streamId);
        if (session) {
            // NOTE: Operations are now sent via SSE to clients, not applied directly to Y.js
            if (message.operations && message.operations.length > 0) {
                debug(
                    `[VIEW] Streaming completed with ${message.operations.length} final operations`,
                );
                debug(
                    `[VIEW] Operations will be sent to clients via SSE, not applied directly to Y.js`,
                );
            }

            // Mark session as complete but don't remove yet - let the main handler do cleanup
            handleStreamingChunkFromAgent(message.streamId, "", true);
        }
    } else if (message.type == "initCollaboration") {
        // Handle collaboration initialization from action handler
        debug("Collaboration initialized from action handler:", message.config);
    }
});

process.on("disconnect", () => {
    process.exit(1);
});

// Add global error handlers to prevent crashes
process.on("uncaughtException", (error) => {
    console.error("[CRITICAL] Uncaught exception:", error);
    // Don't exit immediately, log and continue
    console.error("Service continuing despite error...");
});

process.on("unhandledRejection", (reason, promise) => {
    console.error(
        "[CRITICAL] Unhandled promise rejection at:",
        promise,
        "reason:",
        reason,
    );
    // Don't exit immediately, log and continue
    console.error("Service continuing despite rejection...");
});

// Y.js WebSocket Server Implementation
// A map to store Y.Doc instances for each room
const docs = new Map<string, Y.Doc>();
// A map to store Awareness instances for each room
const awarenessStates = new Map<string, any>();
// Track WebSocket connections per room for debugging
const roomConnections = new Map<string, Set<any>>();
const roomAwarenessConnections = new Map<string, Map<any, Set<number>>>();

/**
 * Get the authoritative Y.js document for a given document ID
 * This ensures we always use the same Y.js document instance across:
 * - WebSocket connections
 * - LLM operations
 * - Auto-save
 * - CollaborationManager
 */
function getAuthoritativeDocument(documentId: string): Y.Doc {
    // Always prefer WebSocket document as single source of truth
    if (docs.has(documentId)) {
        debug(`Using existing WebSocket Y.js document: ${documentId}`);
        return docs.get(documentId)!;
    }

    // Create if doesn't exist
    debug(`Creating new Y.js document: ${documentId}`);
    const ydoc = new Y.Doc();
    docs.set(documentId, ydoc);
    awarenessStates.set(documentId, new Awareness(ydoc));

    // Ensure CollaborationManager uses same instance
    collaborationManager.useExistingDocument(documentId, ydoc, filePath);
    debug(
        `CollaborationManager now using authoritative document: ${documentId}`,
    );

    return ydoc;
}

function evictRoomIfIdle(documentId: string | null): void {
    if (
        documentId === null ||
        documentId === "default" ||
        !docs.has(documentId)
    ) {
        return;
    }
    const attached = roomConnections.get(documentId);
    if (attached && attached.size > 0) {
        return;
    }

    docs.get(documentId)?.destroy();
    docs.delete(documentId);
    awarenessStates.delete(documentId);
    roomConnections.delete(documentId);
    roomAwarenessConnections.delete(documentId);
    collaborationManager.forgetDocument(documentId);
}

// Helper function to setup a Yjs connection (compatible with y-websocket)
function setupWSConnection(conn: any, req: any, roomName: string): void {
    debug(`Setting up WebSocket connection for room: ${roomName}`);

    // Track this connection
    if (!roomConnections.has(roomName)) {
        roomConnections.set(roomName, new Set());
    }
    roomConnections.get(roomName)!.add(conn);

    // Use authoritative document function to ensure single source of truth
    const ydoc = getAuthoritativeDocument(roomName);

    debug(
        `Room ${roomName} has ${roomConnections.get(roomName)!.size} connected clients, document content: ${ydoc.getText("content").length} chars`,
    );

    // Get awareness for this room (should already exist from getAuthoritativeDocument)
    const awareness = awarenessStates.get(roomName)!;

    // Track controlled awareness states for this connection
    const controlledIds = new Set<number>();
    if (!roomAwarenessConnections.has(roomName)) {
        roomAwarenessConnections.set(roomName, new Map());
    }
    roomAwarenessConnections.get(roomName)!.set(conn, controlledIds);

    debug(`Client connected to room: ${roomName}`);

    // Send function for broadcasting to clients
    const send = (doc: Y.Doc, conn: any, message: Uint8Array) => {
        if (conn.readyState === conn.OPEN) {
            try {
                conn.send(message);
            } catch (error) {
                console.error(`Failed to send message to client:`, error);
                closeConnection(doc, conn);
            }
        } else {
            closeConnection(doc, conn);
        }
    };

    // Function to close connection and clean up
    const closeConnection = (doc: Y.Doc, conn: any) => {
        const connMap = roomAwarenessConnections.get(roomName);
        if (connMap && connMap.has(conn)) {
            const controlledIds = connMap.get(conn);
            connMap.delete(conn);

            // Remove awareness states for this connection
            if (controlledIds && controlledIds.size > 0) {
                awarenessProtocol.removeAwarenessStates(
                    awareness,
                    Array.from(controlledIds),
                    null,
                );
            }
        }

        // Remove from room connections
        const connections = roomConnections.get(roomName);
        if (connections) {
            connections.delete(conn);
            debug(
                `Client disconnected from room: ${roomName}, ${connections.size} clients remaining`,
            );
            if (connections.size === 0 && roomName !== getCurrentDocumentId()) {
                evictRoomIfIdle(roomName);
            }
        }
    };

    // Message handler - based on y-websocket-server implementation
    const messageListener = (conn: any, doc: Y.Doc, message: Uint8Array) => {
        try {
            const encoder = encoding.createEncoder();
            const decoder = decoding.createDecoder(message);
            const messageType = decoding.readVarUint(decoder);

            switch (messageType) {
                case 0: // messageSync
                    debug(
                        `Received sync message from client in room: ${roomName}`,
                    );
                    encoding.writeVarUint(encoder, 0); // messageSync
                    syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

                    // If the encoder only contains the type of reply message and no
                    // message, there is no need to send the message. When encoder only
                    // contains the type of reply, its length is 1.
                    if (encoding.length(encoder) > 1) {
                        const responseMessage = encoding.toUint8Array(encoder);
                        debug(
                            `Sending sync response to client: ${responseMessage.length} bytes`,
                        );
                        send(doc, conn, responseMessage);
                    }
                    break;
                case 1: // messageAwareness
                    try {
                        const awarenessUpdate =
                            decoding.readVarUint8Array(decoder);
                        awarenessProtocol.applyAwarenessUpdate(
                            awareness,
                            awarenessUpdate,
                            conn,
                        );
                    } catch (awarenessError) {
                        console.warn(
                            "Error processing awareness message:",
                            awarenessError,
                        );
                    }
                    break;
                default:
                    console.warn(`Unknown message type: ${messageType}`);
                    break;
            }
        } catch (err) {
            console.error("Failed to process WebSocket message:", err);
        }
    };

    // Set up message handling
    conn.on("message", (message: Buffer) => {
        messageListener(conn, ydoc, new Uint8Array(message));
    });

    // Send initial sync step 1 to new client
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync
    syncProtocol.writeSyncStep1(encoder, ydoc);
    const syncMessage = encoding.toUint8Array(encoder);

    debug(
        `Sending initial sync to new client in room: ${roomName}, ${syncMessage.length} bytes, document content: ${ydoc.getText("content").length} chars`,
    );

    send(ydoc, conn, syncMessage);

    // Send document synchronized notification via SSE after initial sync
    setTimeout(() => {
        clients.forEach((client) => {
            try {
                client.write(
                    `data: ${JSON.stringify({
                        type: "documentSynced",
                        documentId: roomName,
                        timestamp: Date.now(),
                    })}\n\n`,
                );
            } catch (error) {
                console.error("[SSE] Failed to send sync notification:", error);
            }
        });
    }, 100); // Small delay to ensure sync is complete

    // Send existing awareness states to new client if any exist
    const awarenessStatesMap = awareness.getStates();
    if (awarenessStatesMap.size > 0) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, 1); // messageAwareness
        encoding.writeVarUint8Array(
            awarenessEncoder,
            awarenessProtocol.encodeAwarenessUpdate(
                awareness,
                Array.from(awarenessStatesMap.keys()),
            ),
        );
        send(ydoc, conn, encoding.toUint8Array(awarenessEncoder));
    }

    // Listen for document updates and broadcast to ALL clients (matching y-websocket-server behavior)
    const updateHandler = (update: Uint8Array, origin: any) => {
        debug(
            `Document update in room: ${roomName}, ${update.length} bytes, origin: ${origin}`,
        );

        const connections = roomConnections.get(roomName);
        if (connections) {
            let broadcastCount = 0;
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 0); // messageSync
            syncProtocol.writeUpdate(encoder, update);
            const message = encoding.toUint8Array(encoder);

            // Broadcast to ALL clients (y-websocket-server broadcasts to all clients)
            // This is correct behavior - the client-side will handle deduplication
            connections.forEach((clientConn) => {
                if (clientConn.readyState === clientConn.OPEN) {
                    send(ydoc, clientConn, message);
                    broadcastCount++;
                }
            });
            debug(
                `Broadcasted update to ${broadcastCount} clients in room: ${roomName}`,
            );
        }
    };
    ydoc.on("update", updateHandler);

    // Handle awareness changes and broadcast to all clients
    const awarenessChangeHandler = (changes: any, origin: any) => {
        try {
            const changedClients = changes.added.concat(
                changes.updated,
                changes.removed,
            );

            // Track controlled client IDs for this connection
            if (origin === conn) {
                const connMap = roomAwarenessConnections.get(roomName);
                const connControlledIDs = connMap?.get(conn);
                if (connControlledIDs) {
                    changes.added.forEach((clientID: number) =>
                        connControlledIDs.add(clientID),
                    );
                    changes.removed.forEach((clientID: number) =>
                        connControlledIDs.delete(clientID),
                    );
                }
            }

            // Broadcast awareness update to all clients
            if (changedClients.length > 0) {
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, 1); // messageAwareness
                encoding.writeVarUint8Array(
                    encoder,
                    awarenessProtocol.encodeAwarenessUpdate(
                        awareness,
                        changedClients,
                    ),
                );
                const message = encoding.toUint8Array(encoder);

                const connections = roomConnections.get(roomName);
                if (connections) {
                    connections.forEach((clientConn) => {
                        if (clientConn.readyState === clientConn.OPEN) {
                            send(ydoc, clientConn, message);
                        }
                    });
                }
            }
        } catch (awarenessError) {
            console.error("Error handling awareness change:", awarenessError);
        }
    };
    awareness.on("change", awarenessChangeHandler);

    // Clean up when client disconnects
    conn.on("close", (code?: number, reason?: string) => {
        try {
            ydoc.off("update", updateHandler);
            awareness.off("change", awarenessChangeHandler);

            closeConnection(ydoc, conn);

            debug(
                `Client disconnected from room: ${roomName}, code: ${code}, reason: ${reason}`,
            );
        } catch (cleanupError) {
            console.error("Error during connection cleanup:", cleanupError);
        }
    });

    conn.on("error", (error: any) => {
        console.error(`WebSocket error in room "${roomName}":`, error);
        closeConnection(ydoc, conn);
    });

    // Add ping/pong to keep connection alive with more lenient timeouts
    let pongReceived = true;
    let missedPings = 0;
    const maxMissedPings = 3; // Allow 3 missed pings before disconnecting

    const pingInterval = setInterval(() => {
        if (!pongReceived) {
            missedPings++;
            debug(
                `Client in room ${roomName} missed ping ${missedPings}/${maxMissedPings}`,
            );

            if (missedPings >= maxMissedPings) {
                debug(
                    `Client in room ${roomName} exceeded missed ping limit, closing connection`,
                );
                closeConnection(ydoc, conn);
                clearInterval(pingInterval);
            }
        } else if (conn.readyState === conn.OPEN) {
            pongReceived = false;
            missedPings = 0; // Reset missed ping counter
            try {
                conn.ping();
            } catch (error) {
                debug(`Failed to ping client in room ${roomName}: ${error}`);
                closeConnection(ydoc, conn);
                clearInterval(pingInterval);
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 45000); // Increased from 30s to 45s to be more lenient

    conn.on("pong", () => {
        pongReceived = true;
        missedPings = 0; // Reset counter on successful pong
        debug(`Received pong from client in room ${roomName}`);
    });

    conn.on("close", () => {
        clearInterval(pingInterval);
    });
}

// Create Yjs WebSocket Server
function createYjsWSServer(server: http.Server): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
        try {
            // Origin gate — same allowlist as the HTTP middleware. The
            // Yjs WS carries the full document content + edit stream,
            // so loopback bind alone isn't enough; any local web page
            // could otherwise open a WS to localhost:<port> and read /
            // mutate the live doc.
            const origin = request.headers.origin as string | undefined;
            if (!isAllowedViewOrigin(origin)) {
                debug(`Rejecting WS upgrade from origin ${origin}`);
                socket.write(
                    "HTTP/1.1 403 Forbidden\r\n" +
                        "Connection: close\r\n" +
                        "Content-Length: 0\r\n" +
                        "\r\n",
                );
                socket.destroy();
                return;
            }

            // Extract room name from URL path
            const url = new URL(
                request.url || "/",
                `http://${request.headers.host}`,
            );
            const roomName = url.pathname.substring(1) || "default-room";

            debug(`WebSocket upgrade request for room: ${roomName}`);

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request, roomName);
            });
        } catch (error) {
            console.error("Error handling WebSocket upgrade:", error);
            socket.destroy();
        }
    });

    wss.on("connection", (ws: any, request: any, roomName: string) => {
        setupWSConnection(ws, request, roomName);
    });

    return wss;
}

// Create HTTP server and integrate WebSocket support
const server = http.createServer(app);

// Add Y.js WebSocket server for real-time collaboration
createYjsWSServer(server);
debug(`[SIGNAL] Y.js WebSocket server integrated`);

// Bind only to loopback. Origin checks are not authentication and requests
// from non-browser clients may legitimately omit the Origin header.
server.listen(port, LOOPBACK_HOST, () => {
    boundPort = (server.address() as { port: number }).port;
    debug(
        `Express server with WebSocket support listening at http://${LOOPBACK_HOST}:${boundPort}`,
    );
    debug(
        `Y.js collaboration available at ws://${LOOPBACK_HOST}:${boundPort}/<room-name>`,
    );

    // Send success signal to parent process AFTER server is ready to accept WebSocket connections
    process.send?.({ type: "Success", port: boundPort });
});

server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("Markdown view server failed to start:", err);
    process.send?.("Failure");
    process.exit(1);
});
