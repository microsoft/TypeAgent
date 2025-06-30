// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class PanelManager {
    private static currentPanel: "schema" | "knowledge" = "schema";
    private static panelChoicesByDomain: Map<string, "schema" | "knowledge"> = new Map();

    static async initialize() {
        console.log("Initializing PanelManager");
        
        // Load saved panel choices
        try {
            const data = await chrome.storage.local.get(['panelChoicesByDomain']);
            if (data.panelChoicesByDomain) {
                this.panelChoicesByDomain = new Map(Object.entries(data.panelChoicesByDomain));
            }
        } catch (error) {
            console.error("Error loading panel choices:", error);
        }

        // Load default panel setting
        try {
            const settings = await chrome.storage.sync.get(['defaultPanel']);
            this.currentPanel = settings.defaultPanel || "schema";
        } catch (error) {
            console.error("Error loading default panel:", error);
        }
    }

    static async openSchemaPanel(tabId: number) {
        console.log("Opening schema panel for tab:", tabId);
        this.currentPanel = "schema";
        
        try {
            await chrome.sidePanel.setOptions({
                tabId: tabId,
                path: 'sidepanel.html',
                enabled: true
            });
            await chrome.sidePanel.open({ tabId });
            
            // Remember choice for domain if setting is enabled
            await this.rememberPanelChoice(tabId, "schema");
        } catch (error) {
            console.error("Error opening schema panel:", error);
        }
    }

    static async openKnowledgePanel(tabId: number) {
        console.log("Opening knowledge panel for tab:", tabId);
        this.currentPanel = "knowledge";
        
        try {
            await chrome.sidePanel.setOptions({
                tabId: tabId,
                path: 'knowledgePanel.html',
                enabled: true
            });
            await chrome.sidePanel.open({ tabId });
            
            // Remember choice for domain if setting is enabled
            await this.rememberPanelChoice(tabId, "knowledge");
        } catch (error) {
            console.error("Error opening knowledge panel:", error);
        }
    }

    static async openDefaultPanel(tabId: number) {
        try {
            // Check if we should remember panel choice for this domain
            const settings = await chrome.storage.sync.get(['rememberPanelChoice']);
            if (settings.rememberPanelChoice) {
                const domain = await this.getDomainForTab(tabId);
                const rememberedChoice = this.panelChoicesByDomain.get(domain);
                if (rememberedChoice) {
                    await this.switchPanel(tabId, rememberedChoice);
                    return;
                }
            }

            // Use default panel
            const defaultSettings = await chrome.storage.sync.get(['defaultPanel']);
            const defaultPanel = defaultSettings.defaultPanel || "schema";
            await this.switchPanel(tabId, defaultPanel);
        } catch (error) {
            console.error("Error opening default panel:", error);
            // Fallback to schema panel
            await this.openSchemaPanel(tabId);
        }
    }

    static getCurrentPanel(): "schema" | "knowledge" {
        return this.currentPanel;
    }

    static async switchPanel(tabId: number, panel: "schema" | "knowledge") {
        if (panel === "schema") {
            await this.openSchemaPanel(tabId);
        } else {
            await this.openKnowledgePanel(tabId);
        }
    }

    private static async rememberPanelChoice(tabId: number, panel: "schema" | "knowledge") {
        try {
            const settings = await chrome.storage.sync.get(['rememberPanelChoice']);
            if (!settings.rememberPanelChoice) return;

            const domain = await this.getDomainForTab(tabId);
            this.panelChoicesByDomain.set(domain, panel);
            
            // Save to storage
            await chrome.storage.local.set({
                panelChoicesByDomain: Object.fromEntries(this.panelChoicesByDomain)
            });
        } catch (error) {
            console.error("Error remembering panel choice:", error);
        }
    }

    private static async getDomainForTab(tabId: number): Promise<string> {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url) {
                return new URL(tab.url).hostname;
            }
        } catch (error) {
            console.error('Error getting domain for tab:', error);
        }
        return 'unknown';
    }
}

// Helper functions
export function getPanelForContext(context: "schema" | "knowledge"): string {
    return context === "schema" ? "sidepanel.html" : "knowledgePanel.html";
}

export async function handleExtensionIconClick(tab: chrome.tabs.Tab) {
    if (tab.id) {
        await PanelManager.openDefaultPanel(tab.id);
    }
}