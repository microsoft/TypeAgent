// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { CollaborationManager } from "./collaborationManager.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import http from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import { Awareness } from "y-protocols/awareness";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import registerDebug from "debug";

const debug = registerDebug("typeagent:markdown:service");

const app: Express = express();
const port = parseInt(process.argv[2]);
if (isNaN(port)) {
    throw new Error("Port must be a number");
}
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

// Document-specific route
app.get("/document/:documentName", (req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

// API endpoint to get current document name from URL
app.get("/api/current-document", (req: Request, res: Response) => {
    res.json({
        currentDocument: filePath ? path.basename(filePath, ".md") : null,
        fullPath: filePath || null,
    });
});

// API endpoint to switch to a specific document
app.post(
    "/api/switch-document",
    express.json(),
    (req: Request, res: Response) => {
        try {
            const { documentName } = req.body;

            if (!documentName) {
                res.status(400).json({ error: "Document name is required" });
                return;
            }

            // Construct file path - in a real implementation, you'd have a documents directory
            // For now, we'll assume documents are in the same directory as the current file
            const documentPath = filePath
                ? path.join(path.dirname(filePath), `${documentName}.md`)
                : `${documentName}.md`;

            if (!fs.existsSync(documentPath)) {
                // Create new document if it doesn't exist
                fs.writeFileSync(
                    documentPath,
                    `# ${documentName}\n\nThis is a new document.\n`,
                );
            }

            // Stop watching old file
            if (filePath) {
                fs.unwatchFile(filePath);
            }

            // Set new file path
            filePath = documentPath;

            // Initialize collaboration for new document
            const documentId = documentName;
            collaborationManager.initializeDocument(documentId, documentPath);

            // Load content into collaboration manager
            const content = fs.readFileSync(documentPath, "utf-8");
            collaborationManager.setDocumentContent(documentId, content);

            // Render to clients
            renderFileToClients(filePath!);

            // Watch new file for changes
            fs.watchFile(filePath!, () => {
                renderFileToClients(filePath!);
            });

            res.json({
                success: true,
                documentName: documentName,
                content: content,
                documentPath: documentPath,
            });
        } catch (error) {
            res.status(500).json({
                error: "Failed to switch document",
                details: error,
            });
        }
    },
);

let clients: any[] = [];
let filePath: string | null;
let collaborationManager: CollaborationManager;

// UI Command routing state
let commandCounter = 0;
const pendingCommands = new Map<string, any>();

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
        const timeout = setTimeout(() => {
            pendingCommands.delete(requestId);
            reject(new Error("Agent command timeout"));
        }, 30000); // 30 second timeout for LLM operations

        // Store resolver for this request
        pendingCommands.set(requestId, { resolve, reject, timeout });

        // Send command to agent process (parent)
        process.send?.({
            type: "uiCommand",
            requestId: requestId,
            command: command,
            parameters: {
                originalRequest: parameters.originalRequest,
                context: parameters.context,
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
        const timeout = setTimeout(() => {
            pendingCommands.delete(requestId);
            activeStreamingSessions.delete(streamId);
            reject(new Error("Agent command timeout"));
        }, 60000); // 60 second timeout for streaming LLM operations

        // Store resolver for this request
        pendingCommands.set(requestId, { resolve, reject, timeout, streamId });

        // Send command to agent process with streaming flag
        process.send?.({
            type: "uiCommand",
            requestId: requestId,
            command: command,
            parameters: {
                originalRequest: parameters.originalRequest,
                context: parameters.context,
                streamId: streamId,
                enableStreaming: true,
            },
            timestamp: Date.now(),
        });
    });
}

/**
 * Determine if a command should use streaming
 */
function shouldCommandStream(originalRequest: string): boolean {
    if (!originalRequest) return false;

    const request = originalRequest.toLowerCase().trim();

    // Stream these commands for better UX
    const streamingCommands = ["/continue", "/augment"];

    // Don't stream these commands (need complete response)
    const nonStreamingCommands = ["/diagram", "/test:diagram"];

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

        // File mode: get content from authoritative document (which should be synced with file)
        const documentId = path.basename(filePath, ".md");
        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");
        const content = ytext.toString();

        debug(
            `Retrieved content from authoritative Y.js doc: ${documentId}, ${content.length} chars`,
        );

        res.send(content);
    } catch (error) {
        // Fallback to reading from file if authoritative document fails
        try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            debug(
                `Fallback read content from file: ${filePath}, ${fileContent.length} chars`,
            );

            res.send(fileContent);
        } catch (fileError) {
            res.status(500).json({
                error: "Failed to load document",
                details: fileError,
            });
        }
    }
});

// Save document from markdown text
app.post("/document", express.json(), (req: Request, res: Response) => {
    const markdownContent = req.body.content || "";

    if (!filePath) {
        // Memory-only mode: save to authoritative Y.js document
        const documentId = "default"; // Use consistent document ID

        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");

        // Replace entire content atomically
        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);

        debug(
            `Saved content to authoritative Y.js doc: ${markdownContent.length} chars`,
        );
        res.json({
            success: true,
            message: "Content saved to memory (no file mode)",
        });

        // Notify clients via SSE of the change (WebSocket will auto-sync)
        renderFileToClients("");
        return;
    }

    try {
        // File mode: save to both authoritative document and file
        const documentId = path.basename(filePath, ".md");
        const ydoc = getAuthoritativeDocument(documentId);
        const ytext = ydoc.getText("content");

        // Update authoritative document first
        ytext.delete(0, ytext.length);
        ytext.insert(0, markdownContent);

        // Then save to file
        fs.writeFileSync(filePath, markdownContent, "utf-8");

        debug(
            `Saved content to both Y.js doc and file: ${filePath}, ${markdownContent.length} chars`,
        );
        res.json({ success: true });

        // Notify clients of the change
        renderFileToClients(filePath);
    } catch (error) {
        res.status(500).json({
            error: "Failed to save document",
            details: error,
        });
    }
});

// Add auto-save endpoint
app.post("/autosave", express.json(), (req: Request, res: Response) => {
    try {
        const { content, filePath: requestFilePath, documentId } = req.body;

        if (!content && content !== "") {
            res.status(400).json({ error: "Content is required" });
            return;
        }

        debug(
            `[AUTO-SAVE] Received auto-save request for document: ${documentId}`,
        );
        debug(
            `Auto-save request received for document: ${documentId}, path: ${requestFilePath}, content: ${content.length} chars`,
        );

        // Use the provided file path or fall back to current filePath
        const targetFilePath = requestFilePath || filePath;
        const targetDocumentId =
            documentId ||
            (filePath ? path.basename(filePath, ".md") : "default");

        if (!targetFilePath) {
            // Memory-only mode: save to authoritative Y.js document
            debug(
                `Memory-only mode auto-save to Y.js document: ${targetDocumentId}`,
            );

            const ydoc = getAuthoritativeDocument(targetDocumentId);
            const ytext = ydoc.getText("content");

            // Replace entire content atomically
            ytext.delete(0, ytext.length);
            ytext.insert(0, content);

            debug(
                `Auto-save completed to Y.js document: ${targetDocumentId}, ${content.length} chars`,
            );

            // Notify clients via SSE
            clients.forEach((client) => {
                try {
                    client.write(
                        `data: ${JSON.stringify({
                            type: "autoSave",
                            documentId: targetDocumentId,
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
                message: "Auto-saved to memory",
                documentId: targetDocumentId,
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
    const currentDocument = filePath
        ? path.basename(filePath, ".md")
        : "default";

    debug(
        `[COLLAB-INFO] Returning collaboration info - currentDocument: "${currentDocument}", filePath: ${filePath}`,
    );

    res.json({
        ...stats,
        websocketServerUrl: `ws://localhost:${port}`,
        currentDocument: currentDocument,
    });
});

// Add file operations endpoints
app.post("/file/load", express.json(), (req: Request, res: Response) => {
    try {
        const { filePath: newFilePath } = req.body;

        if (!newFilePath || !fs.existsSync(newFilePath)) {
            res.status(404).json({ error: "File not found" });
            return;
        }

        // Stop watching old file
        if (filePath) {
            fs.unwatchFile(filePath);
        }

        // Set new file path
        filePath = newFilePath;

        // Initialize collaboration for new document
        const documentId = path.basename(newFilePath, ".md");
        collaborationManager.initializeDocument(documentId, newFilePath);

        // Load content into collaboration manager
        const content = fs.readFileSync(newFilePath, "utf-8");
        collaborationManager.setDocumentContent(documentId, content);

        // Render to clients
        renderFileToClients(filePath!);

        // Watch new file for changes
        fs.watchFile(filePath!, () => {
            renderFileToClients(filePath!);
        });

        res.json({
            success: true,
            fileName: path.basename(newFilePath),
            content: content,
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to load file",
            details: error,
        });
    }
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

/**
 * Detect AI command from user request
 */
/*
function detectAICommand(
    request: string,
): "continue" | "diagram" | "augment" | "research" {
    const lowerRequest = request.toLowerCase();

    if (
        lowerRequest.includes("/continue") ||
        lowerRequest.includes("continue writing")
    ) {
        return "continue";
    }
    if (
        lowerRequest.includes("/diagram") ||
        lowerRequest.includes("create diagram")
    ) {
        return "diagram";
    }
    if (
        lowerRequest.includes("/augment") ||
        lowerRequest.includes("improve") ||
        lowerRequest.includes("enhance")
    ) {
        return "augment";
    }
    if (
        lowerRequest.includes("/research") ||
        lowerRequest.includes("research")
    ) {
        return "research";
    }

    // Default to continue for general content requests
    return "continue";
}
*/

/**
 * Extract hint from user request
 */
/*
function extractHintFromRequest(request: string): string | undefined {
    const match =
        request.match(/\/continue\s+(.+)/i) ||
        request.match(/continue writing\s+(.+)/i);
    return match ? match[1].trim() : undefined;
}
*/

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
                    content: `graph TD\n    A[Start: ${description}] --> B{Process}\n    B --> C[Complete]\n    C --> D[End]`,
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

    req.on("close", () => {
        clients = clients.filter((client) => client !== res);
    });
});

// Serve static files AFTER API routes to avoid conflicts
app.use(express.static(staticPath));

function renderFileToClients(filePath: string) {
    // SSE should only send JSON events, not HTML content
    // HTML content is served via HTTP endpoints, not SSE

    const documentName = filePath ? path.basename(filePath, ".md") : "default";

    // Send a JSON event to notify clients of document changes
    const event = {
        type: "documentUpdated",
        documentName: documentName,
        timestamp: Date.now(),
    };

    clients.forEach((client) => {
        try {
            client.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (error) {
            console.error("[SSE] Failed to send event to client:", error);
        }
    });
}

process.on("message", (message: any) => {
    if (message.type == "setFile") {
        if (filePath) {
            fs.unwatchFile(filePath);
        }
        if (message.filePath) {
            const oldFilePath = filePath;
            filePath = message.filePath;

            // Initialize collaboration for this document using authoritative document
            const documentId = path.basename(message.filePath, ".md");

            // Get or create the authoritative Y.js document
            const ydoc = getAuthoritativeDocument(documentId);

            // Load existing content into the authoritative document
            if (fs.existsSync(message.filePath)) {
                const content = fs.readFileSync(message.filePath, "utf-8");

                // Set content directly in the authoritative Y.js document
                const ytext = ydoc.getText("content");
                ytext.delete(0, ytext.length); // Clear existing content
                ytext.insert(0, content); // Insert file content

                debug(
                    `File loaded into authoritative document: ${documentId}, ${content.length} chars from ${message.filePath}`,
                );
            } else {
                debug(
                    `File doesn't exist, authoritative document ${documentId} remains empty`,
                );
            }

            // Notify frontend clients if the document has changed
            if (oldFilePath !== filePath) {
                // Send SSE notification to all clients to switch rooms
                clients.forEach((client) => {
                    client.write(
                        `data: ${JSON.stringify({
                            type: "documentChanged",
                            newDocumentId: documentId,
                            newDocumentName: path.basename(
                                message.filePath,
                                ".md",
                            ),
                            timestamp: Date.now(),
                        })}\n\n`,
                    );
                });
            }

            // initial render/reset for clients
            renderFileToClients(filePath!);

            // watch file changes and render as needed
            fs.watchFile(filePath!, () => {
                renderFileToClients(filePath!);
            });
        } else {
            // No file mode - initialize with default content using authoritative document
            filePath = null;
            debug("Running in memory-only mode (no file)");

            const documentId = "default";

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

            // Initial render for clients with default content
            renderFileToClients("");
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
        // PRODUCTION: Send operations to PRIMARY client only via SSE to prevent duplicates
        try {
            debug(
                `[VIEW] Forwarding ${message.operations?.length || 0} operations to primary client via SSE`,
            );

            if (clients.length === 0) {
                console.warn(
                    `[SSE] No clients connected to receive operations`,
                );
                process.send?.({
                    type: "operationsApplied",
                    success: false,
                    error: "No clients connected",
                    method: "sse-forwarded",
                });
                return;
            }

            // Send operations to ONLY the first client to prevent duplicates
            const primaryClient = clients[0];
            const operationsEvent = {
                type: "llmOperations",
                operations: message.operations,
                timestamp: message.timestamp || Date.now(),
                source: "agent",
                clientRole: "primary", // Mark this client as the primary applier
            };

            try {
                primaryClient.write(
                    `data: ${JSON.stringify(operationsEvent)}\n\n`,
                );
                debug(
                    `[SSE] Sent ${message.operations?.length || 0} operations to PRIMARY client (${clients.indexOf(primaryClient)} of ${clients.length} clients)`,
                );

                // Notify other clients that operations are being applied (optional)
                if (clients.length > 1) {
                    const notificationEvent = {
                        type: "operationsBeingApplied",
                        timestamp: Date.now(),
                        operationCount: message.operations?.length || 0,
                        source: "agent",
                    };

                    clients.slice(1).forEach((client, index) => {
                        try {
                            client.write(
                                `data: ${JSON.stringify(notificationEvent)}\n\n`,
                            );
                            debug(
                                `[SSE] Notified secondary client ${index + 1} of pending operations`,
                            );
                        } catch (error) {
                            console.error(
                                `[SSE] Failed to notify secondary client ${index + 1}:`,
                                error,
                            );
                        }
                    });
                }
            } catch (error) {
                console.error(
                    "[SSE] Failed to send operations to primary client:",
                    error,
                );
                throw error;
            }

            // Send success confirmation back to agent
            process.send?.({
                type: "operationsApplied",
                success: true,
                operationCount: message.operations?.length || 0,
                method: "sse-forwarded",
                clientsNotified: clients.length,
            });

            debug(`[VIEW] Operations forwarded to primary client successfully`);
        } catch (error) {
            console.error(
                "[VIEW] Failed to forward operations via SSE:",
                error,
            );
            process.send?.({
                type: "operationsApplied",
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                method: "sse-forwarded",
            });
        }
    } else if (message.type === "getDocumentContent") {
        // Handle content requests from agent - read from authoritative Y.js document
        try {
            let documentId = "";

            if (!filePath) {
                // Use default document ID for memory-only mode
                documentId = "default";
            } else {
                documentId = path.basename(filePath, ".md");
            }

            debug("Using documentID " + documentId);

            // Get content from authoritative Y.js document (single source of truth)
            const ydoc = getAuthoritativeDocument(documentId);
            const yText = ydoc.getText("content");
            const content = yText.toString();

            debug(
                `Retrieved content from authoritative Y.js doc ${documentId}: ${content.length} chars`,
            );

            process.send?.({
                type: "documentContent",
                content: content,
                timestamp: Date.now(),
            });

            debug("[SENT] [VIEW] Sent document content to agent process");
        } catch (error) {
            console.error("[VIEW] Failed to get document content:", error);
            process.send?.({
                type: "documentContent",
                content: "",
                timestamp: Date.now(),
            });
        }
    } else if (message.type === "uiCommandResult") {
        // Handle UI command results from agent
        const pending = pendingCommands.get(message.requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            pendingCommands.delete(message.requestId);
            pending.resolve(message.result);
            debug(`[VIEW] Received result for ${message.requestId}`);
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
                debug(
                    `Sent WebSocket message to client: ${message.length} bytes`,
                );
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

    // Add ping/pong to keep connection alive
    let pongReceived = true;
    const pingInterval = setInterval(() => {
        if (!pongReceived) {
            debug(
                `Client in room ${roomName} didn't respond to ping, closing connection`,
            );
            closeConnection(ydoc, conn);
            clearInterval(pingInterval);
        } else if (conn.readyState === conn.OPEN) {
            pongReceived = false;
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
    }, 30000); // Ping every 30 seconds

    conn.on("pong", () => {
        pongReceived = true;
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

// Start the HTTP server (which includes WebSocket support)
server.listen(port, () => {
    debug(`Express server with WebSocket support listening on port ${port}`);
    debug(`Y.js collaboration available at ws://localhost:${port}/<room-name>`);

    // Send success signal to parent process AFTER server is ready to accept WebSocket connections
    process.send?.("Success");
});
