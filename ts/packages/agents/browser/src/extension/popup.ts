// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

class ExtensionPopup {
    private currentTab: chrome.tabs.Tab | null = null;

    async initialize() {
        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        this.currentTab = tabs[0] || null;
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Check connection status
        await this.checkConnectionStatus();
        
        // Load default panel preference
        await this.loadPanelPreference();
    }

    private setupEventListeners() {
        // Panel buttons
        document.getElementById("openSchemaPanel")!.addEventListener("click", () => {
            this.openPanel("schema");
        });

        document.getElementById("openKnowledgePanel")!.addEventListener("click", () => {
            this.openPanel("knowledge");
        });

        // Quick actions
        document.getElementById("extractKnowledge")!.addEventListener("click", (e) => {
            e.preventDefault();
            this.extractKnowledge();
        });

        document.getElementById("indexPage")!.addEventListener("click", (e) => {
            e.preventDefault();
            this.indexPage();
        });

        document.getElementById("openOptions")!.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
            window.close();
        });
    }

    private async openPanel(panel: "schema" | "knowledge") {
        if (!this.currentTab?.id) return;
        
        try {
            await chrome.runtime.sendMessage({
                type: "openPanel",
                panel: panel,
                tabId: this.currentTab.id,
            });
            
            window.close();
        } catch (error) {
            console.error("Error opening panel:", error);
        }
    }

    private async extractKnowledge() {
        if (!this.currentTab?.id) return;
        
        try {
            // Open knowledge panel and trigger extraction
            await chrome.runtime.sendMessage({
                type: "openPanel",
                panel: "knowledge",
                tabId: this.currentTab.id,
                action: "extractKnowledge",
            });
            
            window.close();
        } catch (error) {
            console.error("Error extracting knowledge:", error);
        }
    }

    private async indexPage() {
        if (!this.currentTab?.id) return;
        
        try {
            await chrome.runtime.sendMessage({
                type: "indexPageContentDirect",
            });
            
            // Show brief feedback
            const button = document.getElementById("indexPage")!;
            const originalText = button.textContent;
            button.textContent = "✓ Indexed!";
            button.style.color = "#28a745";
            
            setTimeout(() => {
                window.close();
            }, 1000);
        } catch (error) {
            console.error("Error indexing page:", error);
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkConnection",
            });
            
            const statusElement = document.getElementById("connectionStatus")!;
            
            if (response.connected) {
                statusElement.textContent = "✓ Connected to TypeAgent";
                statusElement.className = "status connected";
            } else {
                statusElement.textContent = "✗ Disconnected from TypeAgent";
                statusElement.className = "status disconnected";
            }
        } catch (error) {
            const statusElement = document.getElementById("connectionStatus")!;
            statusElement.textContent = "✗ Connection error";
            statusElement.className = "status disconnected";
        }
    }

    private async loadPanelPreference() {
        try {
            const settings = await chrome.storage.sync.get(["defaultPanel"]);
            const defaultPanel = settings.defaultPanel || "schema";
            
            // Update visual indication of default panel
            document.querySelectorAll(".panel-button").forEach(button => {
                button.classList.remove("primary");
            });
            
            if (defaultPanel === "knowledge") {
                document.getElementById("openKnowledgePanel")!.classList.add("primary");
            } else {
                document.getElementById("openSchemaPanel")!.classList.add("primary");
            }
        } catch (error) {
            console.error("Error loading panel preference:", error);
        }
    }
}

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    const popup = new ExtensionPopup();
    popup.initialize();
});