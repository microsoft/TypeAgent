// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Import CSS and styles
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles/milkdown-integration.css";
import "./styles/styles.css";
import "./styles/mermaid-styles.css";

// Import core managers
import { EditorManager } from "./core/editor-manager";
import { DocumentManager } from "./core/document-manager";
import { aiAgentManager } from "./core/ai-agent-manager";

// Import UI managers
import { UIManager } from "./ui/ui-manager";

// Import utilities
import { getRequiredElement, eventHandlers } from "./utils";
import { parseDocumentPathFromUrl } from "../route/urlPath.js";

// Global state for the application
let editorManager: EditorManager | null = null;
let documentManager: DocumentManager | null = null;
let uiManager: UIManager | null = null;

// Main initialization
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initializeApplication();
    } catch (error) {
        console.error("Failed to initialize application:", error);
        showError("Failed to initialize editor. Please refresh the page.");
    }
});

async function initializeApplication(): Promise<void> {
    // Parse the target document path from the URL. Nested paths
    // (`/document/team/2025/plan`) and per-segment percent-encoded
    // spaces (`/document/my%20notes`) round-trip end-to-end; the
    // service also matches on the full path so no dirname/basename
    // reduction happens on either side.
    const documentPath = parseDocumentPathFromUrl(window.location.pathname);

    // Initialize managers
    editorManager = new EditorManager();
    documentManager = new DocumentManager();
    uiManager = new UIManager();

    // Initialize UI first
    await uiManager.initialize();

    // Initialize document manager (sets up SSE connection)
    await documentManager.initialize();

    // Connect DocumentManager to UI components
    uiManager.setDocumentManager(documentManager);

    // If the URL asked for a specific document, ask the DocumentManager
    // to align to it. The DocumentManager compares against the binding
    // the service just bootstrapped over SSE, so a redundant switch
    // (URL already matches the bound file) becomes a no-op instead of
    // creating a stray file or rotating the trusted binding token.
    if (documentPath) {
        await switchToDocument(documentPath);
    }

    // Get required DOM elements
    const editorElement = getRequiredElement("editor");

    // Initialize editor
    const editor = await editorManager.initialize(editorElement);

    // Setup cross-manager dependencies
    setupManagerDependencies(editor);

    // Setup event handlers
    eventHandlers.setEditor(editor);
    eventHandlers.setupKeyboardShortcuts();

    // Setup browser history handling
    setupBrowserHistoryHandling();

    // Export for global access (for debugging and compatibility)
    setupGlobalAccess(editor);

    console.log("[APP] Application initialized successfully");
}

async function switchToDocument(documentPath: string): Promise<void> {
    try {
        if (documentManager) {
            await documentManager.switchToDocument(documentPath);
            console.log(
                `[APP] Successfully switched to document: ${documentPath}`,
            );
        } else {
            throw new Error("DocumentManager not initialized");
        }
    } catch (error) {
        console.error("[APP] Failed to switch document:", error);
        showError(`Failed to load document: ${documentPath}`);
    }
}

function setupBrowserHistoryHandling(): void {
    // Handle browser back/forward navigation. Reuse the same nested
    // URL parser as initial load so `/document/team/2025/plan` and
    // percent-encoded segments navigate correctly.
    window.addEventListener("popstate", async () => {
        const target = parseDocumentPathFromUrl(window.location.pathname);
        if (target) {
            await switchToDocument(target);
        }
    });
}

function setupManagerDependencies(editor: any): void {
    // Connect notification manager to other components
    const notificationManager = uiManager!.getNotificationManager();
    documentManager!.setNotificationManager(notificationManager);
    documentManager!.setEditorManager(editorManager);
    aiAgentManager.setNotificationManager(notificationManager);

    // Connect editor to AI agent manager
    aiAgentManager.setEditor(editor);
}

function setupGlobalAccess(editor: any): void {
    // Export for global access (for debugging and slash commands)
    (window as any).editor = editor;
    (window as any).editorManager = editorManager;
    (window as any).executeAgentCommand =
        aiAgentManager.executeAgentCommand.bind(aiAgentManager);
}

function showError(message: string): void {
    console.error(message);

    // Create error notification
    const errorElement = document.createElement("div");
    errorElement.className = "error-notification";
    errorElement.textContent = message;

    document.body.appendChild(errorElement);

    // Remove after 5 seconds
    setTimeout(() => {
        errorElement.remove();
    }, 5000);
}

// Export managers for external access if needed
export { editorManager, documentManager, uiManager, aiAgentManager };
