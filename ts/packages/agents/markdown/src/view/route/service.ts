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
    isCanonicalDirectory,
    normalizeRelativeDocumentPath,
    resolveExistingFileWithinRoot,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "../../agent/pathPolicy.js";
import { computeContentRevision } from "../../agent/contentRevision.js";
import { applyDocumentOperations } from "../../agent/documentOperations.js";
import type { DocumentOperation } from "../../agent/markdownOperationSchema.js";

const debug = registerDebug("typeagent:markdown:service");
// Sentinel error thrown when /api/markdown-response echoes a bindingToken
// that does not match the token pinned to the pending request. Callers
// MUST rethrow this (not fall back to Yjs / on-disk file), because a
// mirror-based fallback paired with a rejected browser echo would let
// stale-mirror content resolve a request that the browser explicitly
// answered under a different binding. Ordinary unavailability (no
// clients connected, timeout, transport error) still falls back through
// the normal path.
class ClientBindingMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ClientBindingMismatchError";
    }
}

const app: Express = express();
const LOOPBACK_HOST = "127.0.0.1";
const port = parseInt(process.argv[2]);
if (isNaN(port)) {
    throw new Error("Port must be a number");
}

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

// Document-specific route. Uses a wildcard so nested user-relative paths
// like /document/docs/team/roadmap round-trip; the browser's SPA reads
// the path itself and does not depend on Express extracting a name.
app.get(/^\/document\/.+/, (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

// API endpoint to get current document name from URL. Reports the same
// relative path (POSIX form) the browser needs to route into nested
// directories; the absolute path is intentionally omitted from the
// public surface - the browser must never trust or emit it, and
// pathPolicy re-validates the relative path server-side on every write.
//
// The bindingToken is intentionally NOT returned here. The browser's
// authoritative source for the current bindingToken is the SSE
// `bindingBootstrap` / `documentChanged` events (and the response to
// `/api/switch-document`); returning it from a broadly-cacheable GET
// invites callers to treat it as an authorization credential, which it
// is not. It is an anti-confusion identity marker whose lifecycle is
// bound to setFile/switch-document rotation events.
app.get("/api/current-document", (req: Request, res: Response) => {
    res.json({
        currentDocument: filePath ? path.basename(filePath, ".md") : null,
        relativePath: boundRelativePath,
        boundRelativePath,
    });
});

// API endpoint to switch to a specific document. Accepts a normalized
// safe relative path under the currently-authorized root. Nested paths
// (`docs/team/roadmap`) are preserved through the switch. Input is
// re-validated against pathPolicy so an attacker-controlled tab cannot
// smuggle traversal. Absolute browser paths are rejected. The response
// carries the freshly-rotated bindingToken, the new documentId (Yjs
// room), and the full relativePath so the browser can adopt them
// atomically before switching editor rooms or issuing an autosave.
app.post(
    "/api/switch-document",
    express.json(),
    (req: Request, res: Response) => {
        try {
            // Accept `documentPath` (preferred) or `documentName` (back-compat).
            // Both go through normalizeRelativeDocumentPath so a nested
            // safe relative path is honored while absolute paths, traversal,
            // and Windows-drive segments are rejected.
            const rawPath =
                typeof req.body?.documentPath === "string"
                    ? req.body.documentPath
                    : typeof req.body?.documentName === "string"
                      ? req.body.documentName
                      : undefined;
            if (typeof rawPath !== "string" || rawPath.length === 0) {
                res.status(400).json({
                    error: "documentPath (or documentName) is required",
                });
                return;
            }

            const normalized = normalizeRelativeDocumentPath(rawPath);
            if (normalized === undefined) {
                res.status(400).json({
                    error: "Invalid document path",
                });
                return;
            }
            const relativeWithExt = normalized.toLowerCase().endsWith(".md")
                ? normalized
                : `${normalized}.md`;

            debug("Switch document called with parameter ", relativeWithExt);

            const root = getValidatedCurrentRoot();
            let safeDocumentPath = resolveWritableFileWithinRoot(
                root,
                relativeWithExt,
                { createSubdirs: true },
            );
            if (safeDocumentPath === undefined) {
                res.status(403).json({
                    error: "Access to the specified path is forbidden.",
                });
                return;
            }

            // Derive a display name for new-file seeding from the last
            // path segment (without .md). We never trust the raw input as
            // a filename target - only for the visible heading.
            const lastSegment = relativeWithExt
                .slice(0, -".md".length)
                .split("/")
                .pop() as string;
            const displayName = sanitizeFilename(lastSegment) || lastSegment;

            if (!fs.existsSync(safeDocumentPath)) {
                fs.writeFileSync(
                    safeDocumentPath,
                    `# ${displayName}\n\nThis is a new document.\n`,
                    { flag: "wx" },
                );
                safeDocumentPath = fs.realpathSync(safeDocumentPath);
            }

            const oldFilePath = filePath;
            // Capture the previous documentId BEFORE we rotate, so
            // that we can evict its Yjs mirror / awareness once we
            // know no clients still need it. This must happen with
            // the old bindingToken still in place - after rotation,
            // getCurrentDocumentId() will return the new token.
            const previousDocumentId = getCurrentDocumentId();
            filePath = safeDocumentPath;
            boundRelativePath = relativeWithExt;
            bindingToken = randomUUID();
            notifyBindingToParent();

            // Room ID for the Yjs mirror / autosave / snapshot broadcasts
            // is scoped to this binding (opaque token), so `a/note.md`
            // and `b/note.md` cannot share a room via matching
            // basenames. The user-visible name stays as the basename.
            const documentId = getCurrentDocumentId();
            // Drop the previous room's state if nothing is holding on
            // to it. The check inside evictRoomIfIdle keeps connected
            // clients from having their Y.Doc yanked mid-session.
            if (previousDocumentId !== documentId) {
                evictRoomIfIdle(previousDocumentId);
            }
            const documentName = path.basename(relativeWithExt, ".md");
            collaborationManager.initializeDocument(
                documentId,
                safeDocumentPath,
            );

            const content = fs.readFileSync(safeDocumentPath, "utf-8");
            debug("Raw content: ", content);

            const ydoc = getAuthoritativeDocument(documentId);
            const ytext = ydoc.getText("content");
            ytext.delete(0, ytext.length);
            ytext.insert(0, content);
            const revision = computeContentRevision(content);

            // Broadcast documentChanged so other browsers connected to
            // this view update their editor room and adopt the new
            // binding token. Skip the broadcast when the underlying file
            // did not change (a re-select of the same path).
            if (oldFilePath !== filePath) {
                const activeToken = bindingToken;
                const activeRelative = boundRelativePath;
                clients.forEach((client) => {
                    try {
                        client.write(
                            `data: ${JSON.stringify({
                                type: "documentChanged",
                                newDocumentId: documentId,
                                newDocumentName: documentName,
                                bindingToken: activeToken,
                                boundRelativePath: activeRelative,
                                revision,
                                timestamp: Date.now(),
                            })}\n\n`,
                        );
                    } catch (sseError) {
                        console.error(
                            "[SSE] Failed to send documentChanged:",
                            sseError,
                        );
                    }
                });
            }

            res.json({
                success: true,
                documentName,
                documentId,
                relativePath: relativeWithExt,
                boundRelativePath: relativeWithExt,
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

// API endpoint to handle markdown response from clients. Each pending
// request records the binding token that was live when the requestMarkdown
// SSE was sent; the browser echoes its `currentBindingToken` in the
// response. When the two disagree (browser rebound mid-flight, or a
// stale/attacker-supplied token) the pending promise is rejected so the
// caller reads/applies against consistent identity rather than pairing new
// content with the old binding.
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
                    debug(
                        `[MARKDOWN-RESPONSE] Rejecting ${requestId}: bindingToken mismatch (expected ${pendingRequest.expectedBindingToken}, got ${responseToken ?? "<none>"})`,
                    );
                    pendingRequest.reject(
                        new ClientBindingMismatchError(
                            `Client markdown response bindingToken mismatch: expected ${pendingRequest.expectedBindingToken}, got ${responseToken ?? "<none>"}`,
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
// The currently-bound relative path under `currentRoot`, normalized to
// POSIX separators. Kept alongside `filePath` so the trusted parent IPC
// can rebind by full user-relative path and recovery on the agent side
// can reproduce the exact original binding rather than reconstructing it
// from `basename(filePath)` (which loses nested directories).
let boundRelativePath: string | null = null;
// Opaque token rotated on every trusted rebinding (setFile from parent IPC
// or /api/switch-document from the browser). The agent tags every read
// and apply IPC with the token it observed, so a switch (even to the same
// basename or same relative path) forces a fresh binding roundtrip and
// prevents stale requests from clobbering the new file.
let bindingToken: string | null = null;
let collaborationManager: CollaborationManager;

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
    // The binding token live when the SSE was sent; the browser must echo
    // it in /api/markdown-response or the pending request is rejected.
    // `null` means "no active binding at request time"; the browser will
    // send `null` too because its currentBindingToken is unset.
    expectedBindingToken: string | null;
};
const pendingMarkdownRequests = new Map<string, PendingMarkdownRequest>();
const userHomeDir = os.homedir();
const INITIAL_ROOT_DIR =
    process.env.TYPEAGENT_MARKDOWN_ROOT || path.join(userHomeDir, "Documents");
// The active document root. Mutated only through the trusted parent IPC
// `setFile` message (see the process message handler below). HTTP routes read
// this variable but never write it, so a compromised browser page cannot
// pivot the server onto another directory.
let currentRoot: string =
    resolveRealDirectory(INITIAL_ROOT_DIR) ?? INITIAL_ROOT_DIR;

function getValidatedCurrentRoot(): string {
    if (!isCanonicalDirectory(currentRoot)) {
        throw new Error("The document root is no longer accessible");
    }
    return currentRoot;
}

// Emit a bindingUpdated IPC message to the parent agent so it can attach the
// rotated token to subsequent read/apply requests. Silently no-ops when
// the process is not IPC-connected (unit-test / standalone runs).
function notifyBindingToParent(): void {
    process.send?.({
        type: "bindingUpdated",
        bindingToken,
        boundFilePath: filePath,
        boundRoot: filePath ? currentRoot : null,
        boundRelativePath,
    });
}

// Validate an inbound IPC message that may carry any of the identity
// expectations (`expectedBindingToken`, `expectedRoot`,
// `expectedRelativePath`). Returns undefined when every expectation
// present in the message matches the current binding; returns a human
// -readable rejection reason otherwise. Callers may also pass a
// pre-captured `snapshot` to check against (used to re-validate a
// snapshot after an in-flight async read that could have raced with a
// rebinding). Unlike an identity match on a basename (which happily
// accepts two files that share `notes` in a nested tree), the token
// is opaque and rotates on every trusted rebinding, so a stale value
// forces the agent through a fresh getDocumentContent before it can
// apply.
type BindingSnapshot = {
    bindingToken: string | null;
    currentRoot: string;
    filePath: string | null;
    boundRelativePath: string | null;
};

function captureBindingSnapshot(): BindingSnapshot {
    return {
        bindingToken,
        currentRoot,
        filePath,
        boundRelativePath,
    };
}

function bindingsDiffer(a: BindingSnapshot, b: BindingSnapshot): boolean {
    return (
        a.bindingToken !== b.bindingToken ||
        a.currentRoot !== b.currentRoot ||
        a.filePath !== b.filePath ||
        a.boundRelativePath !== b.boundRelativePath
    );
}

type BoundWriteValidation =
    | {
          ok: true;
          snapshot: BindingSnapshot;
          targetFilePath: string;
          targetDocumentId: string;
          roomMismatch: boolean;
      }
    | {
          ok: false;
          status: number;
          error: string;
          revision?: string;
          content?: string;
      };

// Shared trust check used by every browser-initiated full-document
// write (POST /document and POST /autosave). It:
//   1. Snapshots the module-level binding at entry so a concurrent
//      setFile / /api/switch-document during the handler cannot swap
//      the target file underneath us.
//   2. Requires the request to carry a bindingToken that matches the
//      snapshot. This is an anti-confusion identity check, not
//      authorization: a stale browser tab that never processed the
//      latest bindingBootstrap MUST NOT be allowed to silently
//      overwrite the new binding with content it authored under the
//      old one.
//   3. Re-validates the root is still a canonical directory and the
//      relative path is still resolvable inside it, so a swapped
//      symlink or a moved workspace root cannot widen the write.
//   4. Chooses the Yjs room by the bound identity, ignoring any
//      documentId the browser sent - the browser value is only
//      inspected for a diagnostic roomMismatch flag.
// Callers still have to re-check `bindingsDiffer` right before the
// actual write in case any awaited work slipped in between.
function validateBoundWriteRequest(body: {
    bindingToken?: unknown;
    documentId?: unknown;
    expectedRevision?: unknown;
}): BoundWriteValidation {
    const requestBindingToken =
        typeof body?.bindingToken === "string" ? body.bindingToken : null;

    const snapshot = captureBindingSnapshot();

    if (!snapshot.filePath) {
        return {
            ok: false,
            status: 409,
            error: "No file is bound. This endpoint requires a parent-established file binding.",
        };
    }

    if (
        snapshot.bindingToken === null ||
        requestBindingToken === null ||
        requestBindingToken !== snapshot.bindingToken
    ) {
        return {
            ok: false,
            status: 409,
            error: "bindingToken is missing or stale. Reload to adopt the current binding.",
        };
    }

    if (!isCanonicalDirectory(snapshot.currentRoot)) {
        return {
            ok: false,
            status: 403,
            error: "The document root is no longer accessible",
        };
    }
    const targetFilePath = resolveWritableFileWithinRoot(
        snapshot.currentRoot,
        snapshot.filePath,
    );
    if (targetFilePath === undefined) {
        return { ok: false, status: 403, error: "Invalid file path" };
    }

    const targetDocumentId = getCurrentDocumentId(snapshot);
    const currentContent = fs.existsSync(targetFilePath)
        ? fs.readFileSync(targetFilePath, "utf-8")
        : "";
    const currentRevision = computeContentRevision(currentContent);
    const expectedRevision =
        typeof body.expectedRevision === "string"
            ? body.expectedRevision
            : undefined;
    if (
        expectedRevision === undefined ||
        expectedRevision !== currentRevision
    ) {
        return {
            ok: false,
            status: 409,
            error:
                expectedRevision === undefined
                    ? "expectedRevision is required for a bound document write."
                    : "Document content changed since it was loaded.",
            revision: currentRevision,
            content: currentContent,
        };
    }

    const rawDocumentId =
        typeof body.documentId === "string" ? body.documentId : undefined;
    const requestedDocumentId = rawDocumentId
        ? sanitizeFilename(rawDocumentId)
        : undefined;
    const roomMismatch =
        requestedDocumentId !== undefined &&
        requestedDocumentId !== targetDocumentId;

    return {
        ok: true,
        snapshot,
        targetFilePath,
        targetDocumentId,
        roomMismatch,
    };
}

// Room ID for the currently-bound document. The Yjs WebSocket room / Yjs
// mirror / autosave target / documentSnapshot broadcasts are keyed by
// this ID. We use the opaque bindingToken (rotated on every trusted
// rebinding) whenever a file is bound, so `a/note.md` and `b/note.md`
// - which share basename `note` - are never coalesced into the same
// Yjs room and cannot cross-write into each other via a browser that
// sent a stale, browser-selected documentId. Memory-only mode has no
// binding and shares the literal "default" room, which is intentional:
// there is no file target, so there is no cross-file risk.
function getCurrentDocumentId(
    snapshot: BindingSnapshot = captureBindingSnapshot(),
): string {
    if (snapshot.filePath && snapshot.bindingToken) {
        return snapshot.bindingToken;
    }
    return "default";
}

function checkExpectedIdentity(
    message: {
        expectedBindingToken?: unknown;
        expectedRoot?: unknown;
        expectedRelativePath?: unknown;
    },
    against: BindingSnapshot = captureBindingSnapshot(),
): string | undefined {
    if (typeof message.expectedBindingToken === "string") {
        if (message.expectedBindingToken !== against.bindingToken) {
            return `Binding token mismatch: expected ${message.expectedBindingToken}, current ${against.bindingToken ?? "<none>"}`;
        }
    }
    if (typeof message.expectedRoot === "string") {
        if (message.expectedRoot !== against.currentRoot) {
            return `Binding root mismatch: expected ${message.expectedRoot}, current ${against.currentRoot}`;
        }
    }
    if (typeof message.expectedRelativePath === "string") {
        if (message.expectedRelativePath !== against.boundRelativePath) {
            return `Binding relative path mismatch: expected ${message.expectedRelativePath}, current ${against.boundRelativePath ?? "<none>"}`;
        }
    }
    return undefined;
}

// Read the current authoritative Markdown for `documentId`. Prefer the
// connected browser (which owns the live editor state and may have edits
// the Yjs mirror has not received yet); fall back to the Yjs mirror and
// then to the raw file, in that order. Both paths return raw Markdown -
// the server never applies operations against ProseMirror offsets.
//
// `snapshot` pins the read to the binding captured at request entry. The
// browser request carries the snapshotted bindingToken and boundRelative
// Path in the SSE payload and echoes the token back in
// /api/markdown-response; a mismatch surfaces as a rejected client
// request, and the file fallback below uses the snapshotted root/file
// so a concurrent rebinding cannot widen the read.
async function readCurrentMarkdownServerSide(
    documentId: string,
    snapshot: BindingSnapshot = captureBindingSnapshot(),
): Promise<string> {
    if (clients.length > 0) {
        try {
            const response = await requestMarkdownFromClient(0, snapshot);
            return response.markdown;
        } catch (error) {
            // A binding-token mismatch means the browser explicitly
            // answered for a different identity than the one the read
            // was pinned to. Rethrow so the caller reports
            // identityMismatch instead of silently reading the Yjs
            // mirror (which would return content for the current
            // binding, then be paired with the caller's stale expected
            // identity - the exact confusion we are guarding).
            if (error instanceof ClientBindingMismatchError) {
                throw error;
            }
            debug(
                `[VIEW] Falling back to Yjs mirror after client-serializer failure: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
    const ydoc = getAuthoritativeDocument(documentId);
    const ytext = ydoc.getText("content");
    const yjsContent = ytext.toString();
    if (yjsContent.length > 0 || !snapshot.filePath) {
        return yjsContent;
    }
    // Last-resort file read for a bound document whose Yjs mirror is
    // still empty (e.g. first read after setFile discovered a missing
    // file). Path validity is re-checked against the SNAPSHOTTED root
    // so a concurrent rebinding cannot widen what we read here.
    if (!isCanonicalDirectory(snapshot.currentRoot)) {
        return "";
    }
    const readableFilePath = resolveExistingFileWithinRoot(
        snapshot.currentRoot,
        snapshot.filePath,
    );
    if (readableFilePath === undefined) {
        return "";
    }
    return fs.readFileSync(readableFilePath, "utf-8");
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
 * Request markdown content from connected client with retry logic. The
 * snapshotted binding is threaded into the SSE payload as
 * `expectedBindingToken` (plus `expectedRelativePath` for logs/debug on
 * the browser side) and stashed on the pending entry so
 * /api/markdown-response can reject a response that echoes back a
 * different token. Retries reuse the SAME snapshot: retrying with the
 * current live binding would defeat the identity check that the caller
 * relied on.
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
    const expectedBindingToken = snapshot.bindingToken;

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

        // Store resolver for this request. Include the expected binding
        // token so /api/markdown-response can reject responses whose echo
        // does not match, which would indicate the browser rebound
        // between the SSE and the response.
        pendingMarkdownRequests.set(requestId, {
            resolve,
            reject,
            timeout,
            expectedBindingToken,
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
                    expectedBindingToken,
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

// Initialize collaboration manager
collaborationManager = new CollaborationManager();

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

        // File mode: get content from the authoritative Y.js doc
        // scoped to the current binding (opaque token). Uses the same
        // room key that setFile / autosave / applyLLMOperations use.
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

// Save document from markdown text. Memory-only mode (no file bound)
// still just writes to the shared "default" Yjs room. File mode goes
// through validateBoundWriteRequest so it applies the same
// bindingToken / snapshot / re-resolve trust checks the /autosave path
// does; a browser that missed a rebinding cannot silently overwrite a
// new binding with content authored against the old one.
app.post("/document", express.json(), (req: Request, res: Response) => {
    const markdownContent =
        typeof req.body?.content === "string" ? req.body.content : "";

    if (!filePath) {
        // Memory-only mode: save to authoritative Y.js document.
        const documentId = "default";
        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");

        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);

        debug(
            `Saved content to authoritative Y.js doc (memory-only): ${markdownContent.length} chars`,
        );
        res.json({
            success: true,
            message: "Content saved to memory (no file mode)",
        });
        return;
    }

    try {
        const validation = validateBoundWriteRequest(req.body ?? {});
        if (!validation.ok) {
            debug(`POST /document rejected: ${validation.error}`);
            res.status(validation.status).json({
                error: validation.error,
                revision: validation.revision,
                content: validation.content,
            });
            return;
        }
        const { snapshot, targetFilePath, targetDocumentId, roomMismatch } =
            validation;
        if (roomMismatch) {
            debug(
                `POST /document documentId mismatch (browser=${
                    typeof req.body?.documentId === "string"
                        ? req.body.documentId
                        : "<none>"
                }, bound=${targetDocumentId}); persisting to bound file`,
            );
        }

        // Guard against a same-tick rebinding between validation and
        // write. This is cheap (no awaits precede it) and fails closed.
        if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
            debug(
                "POST /document rejected: binding rotated between validation and write",
            );
            res.status(409).json({
                error: "Binding rotated during request",
            });
            return;
        }

        const ydoc = getAuthoritativeDocument(targetDocumentId);
        const ytext = ydoc.getText("content");
        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);

        fs.writeFileSync(targetFilePath, markdownContent, "utf-8");
        filePath = targetFilePath;
        const revision = computeContentRevision(markdownContent);

        debug(
            `Saved content to both Y.js doc and file: ${targetFilePath}, ${markdownContent.length} chars`,
        );
        res.json({
            success: true,
            filePath: targetFilePath,
            documentId: targetDocumentId,
            roomMismatch,
            revision,
        });
    } catch (error) {
        console.error("[DOCUMENT] Save failed:", error);
        res.status(500).json({
            error: "Failed to save document",
            details: error instanceof Error ? error.message : error,
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

// Add auto-save endpoint. Like POST /document, it requires the browser
// to identify the binding and revision it edited: the request must carry a
// `bindingToken` that matches the module-level token. Missing or stale
// tokens (browser did not process bindingBootstrap, or another party
// rotated the binding) are rejected without touching disk. The
// browser-supplied `documentId` still may only select the Yjs room -
// never the file target, which is always the SNAPSHOTTED filePath and
// currentRoot captured at request entry.
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
            debug(`Auto-save rejected: ${validation.error}`);
            res.status(validation.status).json({
                error: validation.error,
                revision: validation.revision,
                content: validation.content,
            });
            return;
        }
        const { snapshot, targetFilePath, targetDocumentId, roomMismatch } =
            validation;
        if (roomMismatch) {
            debug(
                `Auto-save documentId mismatch (browser=${
                    typeof req.body?.documentId === "string"
                        ? req.body.documentId
                        : "<none>"
                }, bound=${targetDocumentId}); persisting to bound file`,
            );
        }
        debug(
            `Auto-save request received for bound document: ${targetDocumentId}, path: ${targetFilePath}, content: ${content.length} chars`,
        );

        // Guard once more against a rebinding that raced our snapshot
        // capture. Between validateBoundWriteRequest and the write below
        // we did no `await`, but the token could still have rotated on
        // a same-tick IPC. This is cheap and fails closed.
        if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
            debug(
                "Auto-save rejected: binding rotated between validation and write",
            );
            res.status(409).json({
                error: "Autosave binding rotated during request",
            });
            return;
        }

        // File mode: save to both authoritative document and file
        const ydoc = getAuthoritativeDocument(targetDocumentId);
        const ytext = ydoc.getText("content");

        // Update authoritative document first
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);

        // Then save to file
        fs.writeFileSync(targetFilePath, content, "utf-8");
        const revision = computeContentRevision(content);

        debug(
            `Auto-save completed to both Y.js document and file: ${targetFilePath}, ${content.length} chars`,
        );

        // Notify clients via SSE
        clients.forEach((client) => {
            try {
                client.write(
                    `data: ${JSON.stringify({
                        type: "autoSave",
                        filePath: targetFilePath,
                        documentId: targetDocumentId,
                        bindingToken: snapshot.bindingToken,
                        revision,
                        contentLength: content.length,
                        timestamp: Date.now(),
                    })}\n\n`,
                );
            } catch (error) {
                console.error(
                    "[SSE] Failed to send auto-save event to client:",
                    error,
                );
            }
        });

        res.json({
            success: true,
            message: "Auto-saved successfully",
            filePath: targetFilePath,
            documentId: targetDocumentId,
            roomMismatch,
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

    // The browser MUST use `documentId` (the opaque bindingToken when
    // bound, `"default"` otherwise) as the Yjs room key. Two files that
    // happen to share a basename (e.g. `a/note.md` and `b/note.md`) get
    // distinct documentIds and therefore distinct rooms; deriving the
    // room from the basename on the browser side would cross-collab
    // them. `currentDocument` is retained only as a human-readable
    // display name for logs and page titles.
    const snapshot = captureBindingSnapshot();
    const documentId = getCurrentDocumentId(snapshot);
    const currentDocument = snapshot.filePath
        ? path.basename(snapshot.filePath, ".md")
        : "default";

    debug(
        `[COLLAB-INFO] Returning collaboration info - documentId: "${documentId}", currentDocument: "${currentDocument}", filePath: ${snapshot.filePath}`,
    );

    res.json({
        ...stats,
        websocketServerUrl: `ws://${LOOPBACK_HOST}:${port}`,
        documentId,
        currentDocument,
    });
});

app.get("/file/info", (req: Request, res: Response) => {
    if (!filePath) {
        res.status(404).json({ error: "No file loaded" });
        return;
    }

    try {
        const readableFilePath = resolveExistingFileWithinRoot(
            getValidatedCurrentRoot(),
            filePath,
        );
        if (readableFilePath === undefined) {
            res.status(403).json({ error: "Access to the file is forbidden" });
            return;
        }
        const stats = fs.statSync(readableFilePath);
        res.json({
            fileName: path.basename(readableFilePath),
            fullPath: readableFilePath,
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
    // Assign primary/secondary role from SSE ordering. The first
    // connected client is the primary autosave writer; subsequent
    // browsers do not autosave. When the primary disconnects (close
    // handler below) we promote the next client and send it a
    // `primaryElected` SSE so it flips its autosave flag on. This
    // replaces the earlier scheme where the role was implicit in
    // now-removed `llmOperations` events, so a browser could sit
    // forever as a non-writer.
    const clientRole = clients[0] === res ? "primary" : "secondary";

    // Bootstrap the newly-connected browser with the currently-active
    // binding. Without this a browser that connected AFTER the last
    // setFile / /api/switch-document (i.e. it missed the documentChanged
    // SSE) would have no token to compare a documentSnapshot against.
    // The bootstrap from the trusted same-origin service is authoritative
    // on every connection, so the browser adopts it atomically rather
    // than ignoring a differing token from a stale in-memory value.
    try {
        // Room ID uses the current binding token (opaque, unique per
        // binding), so a browser connecting after setFile joins the
        // same room the Yjs mirror is keyed under. The user-facing
        // name stays as the basename for URL / title purposes.
        const currentDocumentId = filePath ? getCurrentDocumentId() : null;
        const currentDocumentName = filePath
            ? path.basename(filePath, ".md")
            : null;
        const revision = filePath
            ? computeContentRevision(
                  fs.existsSync(filePath)
                      ? fs.readFileSync(filePath, "utf-8")
                      : "",
              )
            : null;
        res.write(
            `data: ${JSON.stringify({
                type: "bindingBootstrap",
                bindingToken,
                documentId: currentDocumentId,
                documentName: currentDocumentName,
                boundRelativePath,
                revision,
                clientRole,
                timestamp: Date.now(),
            })}\n\n`,
        );
    } catch (bootstrapError) {
        console.error("[SSE] Failed to send bindingBootstrap:", bootstrapError);
    }

    req.on("close", () => {
        const wasPrimary = clients[0] === res;
        clients = clients.filter((client) => client !== res);
        if (wasPrimary && clients.length > 0) {
            // Promote the next-connected browser so autosave keeps
            // working when the previous primary tab closes. Include the
            // persisted revision so a secondary that did not perform the
            // previous save can use the current optimistic-concurrency base.
            const promoted = clients[0];
            try {
                const snapshot = captureBindingSnapshot();
                const persistedContent = snapshot.filePath
                    ? fs.existsSync(snapshot.filePath)
                        ? fs.readFileSync(snapshot.filePath, "utf-8")
                        : ""
                    : getAuthoritativeDocument("default")
                          .getText("content")
                          .toString();
                promoted.write(
                    `data: ${JSON.stringify({
                        type: "primaryElected",
                        bindingToken: snapshot.bindingToken,
                        revision: computeContentRevision(persistedContent),
                        timestamp: Date.now(),
                    })}\n\n`,
                );
            } catch (promoteError) {
                console.error(
                    "[SSE] Failed to send primaryElected:",
                    promoteError,
                );
            }
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
        // Only trusted parent IPC can reroot the service. HTTP routes can
        // select files within currentRoot but cannot change that root.
        // The message shape is `{ workspaceRoot, relativePath }`: the agent
        // passes the canonical workspace root it authorized (from the host
        // ActionContext.workingDirectory) and the full normalized user
        // -relative path. Preserving the nested relative path (rather than
        // reducing to basename+dirname) keeps subdirectory layouts intact
        // through recovery.
        const nextRoot =
            typeof message.workspaceRoot === "string" && message.workspaceRoot
                ? resolveRealDirectory(message.workspaceRoot)
                : currentRoot;
        if (nextRoot === undefined) {
            debug(
                `Ignoring setFile: workspaceRoot ${message.workspaceRoot} is not a real directory`,
            );
            return;
        }
        const rawRelative =
            typeof message.relativePath === "string"
                ? message.relativePath
                : "";
        if (rawRelative) {
            const relative = normalizeRelativeDocumentPath(rawRelative);
            if (relative === undefined) {
                debug(
                    `Ignoring setFile: relativePath ${rawRelative} is not a safe relative path`,
                );
                return;
            }
            const resolvedFilePath = resolveWritableFileWithinRoot(
                nextRoot,
                relative,
            );
            if (resolvedFilePath === undefined) {
                debug(
                    `Ignoring setFile: relativePath ${rawRelative} escapes workspaceRoot`,
                );
                return;
            }

            if (currentRoot !== nextRoot) {
                currentRoot = nextRoot;
                debug(`Document root switched to ${currentRoot}`);
            }

            const oldFilePath = filePath;
            // Capture previous documentId before rotation so we can
            // evict its Yjs mirror when nothing is holding it.
            const previousDocumentId = getCurrentDocumentId();
            filePath = resolvedFilePath;
            boundRelativePath = relative;
            // Rotate the binding token on every accepted rebinding, including
            // rebinding to the same basename or same relative path. Callers
            // that observed the previous token are then forced through a
            // fresh read before they can apply.
            bindingToken = randomUUID();
            notifyBindingToParent();

            // Room ID is scoped to this binding (opaque token) - see
            // getCurrentDocumentId(). Display name stays as the file
            // basename for the URL / title.
            const documentId = getCurrentDocumentId();
            if (previousDocumentId !== documentId) {
                evictRoomIfIdle(previousDocumentId);
            }
            const documentName = path.basename(relative, ".md");

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
                    `File loaded into authoritative document: ${documentId}, ${content.length} chars from ${relative}`,
                );
            } else {
                debug(
                    `File doesn't exist, authoritative document ${documentId} remains empty`,
                );
            }
            const revision = computeContentRevision(
                ydoc.getText("content").toString(),
            );

            // Notify frontend clients if the document has changed
            if (oldFilePath !== filePath) {
                const activeToken = bindingToken;
                const activeRelative = boundRelativePath;
                clients.forEach((client) => {
                    client.write(
                        `data: ${JSON.stringify({
                            type: "documentChanged",
                            newDocumentId: documentId,
                            newDocumentName: documentName,
                            bindingToken: activeToken,
                            boundRelativePath: activeRelative,
                            revision,
                            timestamp: Date.now(),
                        })}\n\n`,
                    );
                });
            }
        } else {
            currentRoot = nextRoot;
            // Capture the previous documentId before dropping to
            // memory-only mode, so we can evict the room state that
            // no longer has a bound file.
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
    } else if (message.type === "applyLLMOperations") {
        const requestId =
            typeof message.requestId === "string" ? message.requestId : "";
        // Snapshot the binding at request start. `readCurrentMarkdown
        // ServerSide` awaits, and a setFile / /api/switch-document
        // during that await would otherwise let us persist operations
        // against a file the agent never authorized. After the await
        // we re-check the snapshot and reject if the binding rotated.
        // The snapshot is hoisted out of the try so the outer catch
        // (which reports back to the agent) can still surface the
        // binding identity we were operating under.
        const snapshot = captureBindingSnapshot();
        const snapshotDocumentId = getCurrentDocumentId(snapshot);
        try {
            if (!Array.isArray(message.operations)) {
                throw new Error("Document operations must be an array");
            }

            const bindingCheck = checkExpectedIdentity(message, snapshot);
            if (bindingCheck !== undefined) {
                process.send?.({
                    type: "operationsApplied",
                    requestId,
                    success: false,
                    identityMismatch: true,
                    error: bindingCheck,
                    bindingToken: snapshot.bindingToken,
                    documentId: snapshotDocumentId,
                    method: "binding-check",
                });
                return;
            }

            // Server-authoritative apply. Regardless of whether a browser is
            // connected, the view resolves the operations against raw
            // Markdown and persists the result. When the browser is present
            // we pull its current serialized Markdown (via the existing
            // requestMarkdown SSE), verify it matches the base revision the
            // agent read, then apply and push a post-commit snapshot back
            // so the editor adopts the new text. Browser presence never
            // changes the persistence semantics.
            const operations = message.operations as DocumentOperation[];
            const currentMarkdown = await readCurrentMarkdownServerSide(
                snapshotDocumentId,
                snapshot,
            );

            // Re-check the snapshot after the potentially-awaiting read.
            // A concurrent setFile/switch-document during the await would
            // have rotated bindingToken/filePath; persisting against the
            // new binding with content read for the old one is exactly
            // the race we are guarding.
            if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
                debug(
                    `[VIEW] Rejecting applyLLMOperations: binding rotated during in-flight read (requestId ${requestId})`,
                );
                process.send?.({
                    type: "operationsApplied",
                    requestId,
                    success: false,
                    identityMismatch: true,
                    error: "Binding rotated during in-flight read",
                    bindingToken,
                    documentId: snapshotDocumentId,
                    method: "binding-recheck",
                });
                return;
            }

            const expectedRevision =
                typeof message.expectedRevision === "string"
                    ? message.expectedRevision
                    : undefined;
            const baseRevision = computeContentRevision(currentMarkdown);
            if (
                expectedRevision !== undefined &&
                expectedRevision !== baseRevision
            ) {
                debug(
                    `[VIEW] Rejecting applyLLMOperations: revision mismatch (expected ${expectedRevision}, current ${baseRevision})`,
                );
                process.send?.({
                    type: "operationsApplied",
                    requestId,
                    success: false,
                    revisionMismatch: true,
                    error: "Document content changed since the agent read it",
                    bindingToken: snapshot.bindingToken,
                    revision: baseRevision,
                    documentId: snapshotDocumentId,
                    method: "revision-check",
                });
                return;
            }

            // Resolve the write target against the snapshotted filePath +
            // currentRoot. Using globals here would race a concurrent
            // rebinding; the snapshot recheck above only guarantees state
            // was consistent at entry and after the await, so we still
            // pin the write to the snapshot.
            let writableFilePath: string | undefined;
            if (snapshot.filePath) {
                if (!isCanonicalDirectory(snapshot.currentRoot)) {
                    throw new Error(
                        "The document root is no longer accessible",
                    );
                }
                writableFilePath = resolveWritableFileWithinRoot(
                    snapshot.currentRoot,
                    snapshot.filePath,
                );
                if (writableFilePath === undefined) {
                    throw new Error("Access to the file is forbidden");
                }
            }

            const updatedContent = applyDocumentOperations(
                currentMarkdown,
                operations,
            );

            // Update the authoritative Yjs mirror so any concurrent
            // WebSocket peer receives the raw-Markdown update.
            const ydoc = getAuthoritativeDocument(snapshotDocumentId);
            const ytext = ydoc.getText("content");
            ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, updatedContent);
            });

            if (writableFilePath) {
                fs.writeFileSync(writableFilePath, updatedContent, "utf-8");
                filePath = writableFilePath;
            }

            const revision = computeContentRevision(updatedContent);

            // Post-commit snapshot: tell browsers to reload from the raw
            // Markdown the server just persisted. The snapshot carries the
            // active binding token so a browser that has since rebound
            // discards it instead of clobbering its editor. We use the
            // snapshotted token here because `bindingToken` above was
            // proven equal to the snapshot at this point.
            if (snapshot.bindingToken) {
                const publishedSnapshot = {
                    type: "documentSnapshot",
                    bindingToken: snapshot.bindingToken,
                    markdown: updatedContent,
                    revision,
                    timestamp: Date.now(),
                };
                clients.forEach((client) => {
                    try {
                        client.write(
                            `data: ${JSON.stringify(publishedSnapshot)}\n\n`,
                        );
                    } catch (sseError) {
                        console.error(
                            "[SSE] Failed to send documentSnapshot:",
                            sseError,
                        );
                    }
                });
            }

            debug(
                `[VIEW] Applied ${operations.length} operations to ${snapshotDocumentId} (revision ${revision})`,
            );

            process.send?.({
                type: "operationsApplied",
                requestId,
                success: true,
                operationCount: operations.length,
                method: "server-applied",
                clientsNotified: clients.length,
                bindingToken: snapshot.bindingToken,
                revision,
                documentId: snapshotDocumentId,
            });
        } catch (error) {
            if (error instanceof ClientBindingMismatchError) {
                // Same fail-closed rule as getDocumentContent: the
                // server-authoritative read that fed this apply came
                // from a browser that answered under a mismatched
                // binding. Report identityMismatch so the agent forces
                // a fresh read under the current binding, rather than
                // treating the failure as a generic apply error.
                debug(
                    `[VIEW] Rejecting applyLLMOperations: browser echoed mismatched bindingToken (requestId ${requestId})`,
                );
                process.send?.({
                    type: "operationsApplied",
                    requestId,
                    success: false,
                    identityMismatch: true,
                    error: error.message,
                    bindingToken: snapshot.bindingToken,
                    documentId: snapshotDocumentId,
                    method: "client-binding-mismatch",
                });
                return;
            }
            console.error("[VIEW] Failed to apply operations:", error);
            process.send?.({
                type: "operationsApplied",
                requestId,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                bindingToken,
                method: "server-applied",
            });
        }
    } else if (message.type === "getDocumentContent") {
        debug(
            `[VIEW] Processing getDocumentContent request at ${new Date().toISOString()}`,
        );
        // Handle content requests from agent - try client markdown first, fallback to Y.js
        // Process this asynchronously to avoid blocking other messages
        (async () => {
            const requestId =
                typeof message.requestId === "string" ? message.requestId : "";

            // Snapshot binding state at request entry. `requestMarkdown
            // FromClient` awaits a network round-trip to the browser,
            // and a setFile / /api/switch-document during that await
            // could otherwise let us return content paired with a
            // newly-rotated binding token. We re-check after the await
            // and fail closed as identityMismatch when the snapshot no
            // longer holds.
            const snapshot = captureBindingSnapshot();
            const snapshotDocumentId = getCurrentDocumentId(snapshot);
            const snapshotBoundFilePath = snapshot.filePath ?? null;
            const snapshotBoundRoot = snapshotBoundFilePath
                ? snapshot.currentRoot
                : null;
            const snapshotBoundRelativePath = snapshot.boundRelativePath;

            const bindingCheck = checkExpectedIdentity(message, snapshot);
            if (bindingCheck !== undefined) {
                process.send?.({
                    type: "documentContent",
                    requestId,
                    content: "",
                    source: "error",
                    identityMismatch: true,
                    error: bindingCheck,
                    bindingToken: snapshot.bindingToken,
                    boundDocumentId: snapshotDocumentId,
                    boundFilePath: snapshotBoundFilePath,
                    boundRoot: snapshotBoundRoot,
                    boundRelativePath: snapshotBoundRelativePath,
                    revision: null,
                    timestamp: Date.now(),
                });
                return;
            }
            try {
                debug("Using documentID " + snapshotDocumentId);

                let content = "";
                let source = "unknown";

                try {
                    // PRIMARY: Try to get proper markdown from connected client
                    if (clients.length > 0) {
                        debug(
                            `[VIEW] Attempting to get markdown from connected client...`,
                        );
                        const markdownResponse =
                            await requestMarkdownFromClient(0, snapshot);
                        content = markdownResponse.markdown;
                        source = "client-serializer";
                        debug(
                            `[VIEW] Retrieved markdown from client: ${content.length} chars`,
                        );
                    } else {
                        throw new Error("No clients connected");
                    }
                } catch (clientError) {
                    // Browser explicitly answered under a mismatched
                    // binding token. Do NOT fall back to the Yjs mirror
                    // / file: those would return content for the
                    // current binding while the agent has pinned an
                    // expected identity, and the mismatch would be
                    // silently laundered as apparently-fresh content.
                    if (clientError instanceof ClientBindingMismatchError) {
                        debug(
                            `[VIEW] Rejecting getDocumentContent: browser echoed mismatched bindingToken (requestId ${requestId})`,
                        );
                        process.send?.({
                            type: "documentContent",
                            requestId,
                            content: "",
                            source: "error",
                            identityMismatch: true,
                            error: clientError.message,
                            bindingToken: snapshot.bindingToken,
                            boundDocumentId: snapshotDocumentId,
                            boundFilePath: snapshotBoundFilePath,
                            boundRoot: snapshotBoundRoot,
                            boundRelativePath: snapshotBoundRelativePath,
                            revision: null,
                            timestamp: Date.now(),
                        });
                        return;
                    }
                    const errorMessage =
                        clientError instanceof Error
                            ? clientError.message
                            : String(clientError);
                    debug(
                        `[VIEW] Failed to get markdown from client (${errorMessage}), falling back to Y.js`,
                    );

                    // FALLBACK: Get content from authoritative Y.js document
                    const ydoc = getAuthoritativeDocument(snapshotDocumentId);
                    const yText = ydoc.getText("content");
                    content = yText.toString();
                    source = "yjs-fallback";
                    debug(
                        `[VIEW] Retrieved content from Y.js fallback: ${content.length} chars`,
                    );

                    // If Y.js is also empty, try reading from file as last
                    // resort. Validate the snapshotted path against the
                    // snapshotted root so a concurrent rebinding cannot
                    // widen what we read here.
                    if (!content && snapshot.filePath) {
                        try {
                            if (!isCanonicalDirectory(snapshot.currentRoot)) {
                                throw new Error(
                                    "The document root is no longer accessible",
                                );
                            }
                            const readableFilePath =
                                resolveExistingFileWithinRoot(
                                    snapshot.currentRoot,
                                    snapshot.filePath,
                                );
                            if (readableFilePath === undefined) {
                                throw new Error(
                                    "Access to the file is forbidden",
                                );
                            }
                            content = fs.readFileSync(
                                readableFilePath,
                                "utf-8",
                            );
                            source = "file-fallback";
                            debug(
                                `[VIEW] Retrieved content from file fallback: ${content.length} chars`,
                            );
                        } catch (fileError) {
                            debug(
                                `[VIEW] File fallback also failed: ${fileError}`,
                            );
                        }
                    }
                }

                // Re-check the snapshot after the possibly-awaiting read.
                // If binding rotated during the round-trip, fail closed
                // with identityMismatch so the agent does not pair the
                // browser-selected content with its old identity.
                if (bindingsDiffer(captureBindingSnapshot(), snapshot)) {
                    debug(
                        `[VIEW] Rejecting getDocumentContent: binding rotated during in-flight read (requestId ${requestId})`,
                    );
                    process.send?.({
                        type: "documentContent",
                        requestId,
                        content: "",
                        source: "error",
                        identityMismatch: true,
                        error: "Binding rotated during in-flight read",
                        bindingToken,
                        boundDocumentId: snapshotDocumentId,
                        boundFilePath: snapshotBoundFilePath,
                        boundRoot: snapshotBoundRoot,
                        boundRelativePath: snapshotBoundRelativePath,
                        revision: null,
                        timestamp: Date.now(),
                    });
                    return;
                }

                debug(
                    `[VIEW] Sending document content to agent (source: ${source}, ${content.length} chars)`,
                );

                process.send?.({
                    type: "documentContent",
                    requestId,
                    content: content,
                    source: source,
                    timestamp: Date.now(),
                    bindingToken: snapshot.bindingToken,
                    boundDocumentId: snapshotDocumentId,
                    boundFilePath: snapshotBoundFilePath,
                    boundRoot: snapshotBoundRoot,
                    boundRelativePath: snapshotBoundRelativePath,
                    revision: computeContentRevision(content),
                });

                debug("[SENT] [VIEW] Sent document content to agent process");
            } catch (error) {
                console.error("[VIEW] Failed to get document content:", error);
                process.send?.({
                    type: "documentContent",
                    requestId,
                    content: "",
                    source: "error",
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                    timestamp: Date.now(),
                    bindingToken: snapshot.bindingToken,
                    boundDocumentId: snapshotDocumentId,
                    boundFilePath: snapshotBoundFilePath,
                    boundRoot: snapshotBoundRoot,
                    boundRelativePath: snapshotBoundRelativePath,
                    revision: null,
                });
            }
        })();
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

/**
 * Free the Y.Doc / Awareness / connection-tracking state for a room
 * whose binding just rotated away. Callers pass the OLD documentId
 * captured before the rotation. We refuse to evict when any WebSocket
 * client is still attached to the old room; a connected client is
 * likely still syncing or authoring against that mirror and pulling it
 * out from under them would corrupt their editor. When the room is
 * idle (no attached sockets) we destroy the Y.Doc, drop the Awareness
 * instance, and let CollaborationManager forget it too.
 */
function evictRoomIfIdle(oldDocumentId: string | null): void {
    if (oldDocumentId === null || oldDocumentId === "default") {
        // "default" is a shared memory-only fallback; keep it around.
        return;
    }
    if (!docs.has(oldDocumentId)) {
        return;
    }
    const attached = roomConnections.get(oldDocumentId);
    if (attached && attached.size > 0) {
        debug(
            `Skipping eviction of ${oldDocumentId}: ${attached.size} client(s) still attached`,
        );
        return;
    }
    try {
        const ydoc = docs.get(oldDocumentId);
        if (ydoc) {
            ydoc.destroy();
        }
    } catch (error) {
        console.error(
            `[EVICT] Failed to destroy Y.Doc for ${oldDocumentId}:`,
            error,
        );
    }
    docs.delete(oldDocumentId);
    awarenessStates.delete(oldDocumentId);
    roomConnections.delete(oldDocumentId);
    roomAwarenessConnections.delete(oldDocumentId);
    collaborationManager.forgetDocument(oldDocumentId);
    debug(`Evicted idle Y.Doc / awareness room: ${oldDocumentId}`);
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
    const boundPort = (server.address() as { port: number }).port;
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
