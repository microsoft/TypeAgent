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
    // Check if we have a document name in the URL
    const urlPath = window.location.pathname;
    const documentNameMatch = urlPath.match(/\/document\/([^\/]+)/);
    const documentName = documentNameMatch ? documentNameMatch[1] : null;

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

    // If we have a document name in URL, switch to that document
    if (documentName) {
        await switchToDocument(documentName);
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

async function switchToDocument(documentName: string): Promise<void> {
    try {
        if (documentManager) {
            await documentManager.switchToDocument(documentName);
            console.log(
                `[APP] Successfully switched to document: ${documentName}`,
            );
        } else {
            throw new Error("DocumentManager not initialized");
        }
    } catch (error) {
        console.error("[APP] Failed to switch document:", error);
        showError(`Failed to load document: ${documentName}`);
    }
}

function setupBrowserHistoryHandling(): void {
    // Handle browser back/forward navigation
    window.addEventListener("popstate", async (event) => {
        const urlPath = window.location.pathname;
        const documentNameMatch = urlPath.match(/\/document\/([^\/]+)/);
        const documentName = documentNameMatch ? documentNameMatch[1] : null;

        if (documentName && event.state?.documentName !== documentName) {
            await switchToDocument(documentName);
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
