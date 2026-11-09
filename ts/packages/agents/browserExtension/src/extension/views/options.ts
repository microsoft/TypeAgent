// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChromeRpcClient } from "./chromeRpcClient";
import {
    DEFAULT_EXTENSION_SETTINGS as DEFAULT_SETTINGS,
    type ExtensionSettings,
} from "../serviceWorker/storage";
import {
    isCrosswordMode,
    isCrosswordDecisionStrategy,
    type CrosswordDecisionCapabilities,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { isShoppingMode } from "@typeagent/browser-control-rpc/uiDecisionTypes";

let chromeRpcSingleton: ReturnType<typeof createChromeRpcClient> | undefined;
function getChromeRpc() {
    if (!chromeRpcSingleton) chromeRpcSingleton = createChromeRpcClient();
    return chromeRpcSingleton;
}

interface AIModelStatus {
    available: boolean;
    version?: string;
    endpoint?: string;
    lastChecked?: string;
}

export class EnhancedOptionsPage {
    private settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    private aiStatus: AIModelStatus = { available: false };
    private crosswordCapabilities?: CrosswordDecisionCapabilities;

    constructor() {
        this.initializeEventListeners();
    }

    async initialize() {
        await this.loadSavedSettings();
        await Promise.all([
            this.checkAIModelStatus(),
            this.checkCrosswordDecisionCapabilities(),
        ]);
        this.updateRangeDisplays();
        this.updateAIStatusDisplay();
    }

    private initializeEventListeners() {
        // Form submission
        const optionsForm = document.getElementById(
            "optionsForm",
        ) as HTMLFormElement;
        optionsForm.addEventListener("submit", (e) => this.saveOptions(e));
        document
            .getElementById("crosswordMode")
            ?.addEventListener("change", () =>
                this.updateCrosswordDecisionStatus(),
            );

        // Range inputs
        const concurrencyRange = document.getElementById(
            "maxConcurrentExtractions",
        ) as HTMLInputElement;
        concurrencyRange.addEventListener("input", () => {
            this.updateConcurrencyDisplay(parseInt(concurrencyRange.value));
        });

        const qualityRange = document.getElementById(
            "qualityThreshold",
        ) as HTMLInputElement;
        qualityRange.addEventListener("input", () => {
            this.updateQualityDisplay(parseFloat(qualityRange.value));
        });

        // Other controls
        document
            .getElementById("resetToDefaults")
            ?.addEventListener("click", () => {
                this.resetToDefaults();
            });

        document
            .getElementById("exportSettings")
            ?.addEventListener("click", () => {
                this.exportSettings();
            });
    }

    private async loadSavedSettings() {
        try {
            const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            await this.repairShoppingMode(saved);
            if (!isCrosswordMode(saved.crosswordMode)) {
                console.warn(
                    "Invalid crossword mode; resetting to Generative.",
                );
                saved.crosswordMode = DEFAULT_SETTINGS.crosswordMode;
                await chrome.storage.sync.set({
                    crosswordMode: saved.crosswordMode,
                });
                this.showStatus(
                    "Invalid Crossword Mode was reset to Generative.",
                    "warning",
                );
                await this.notifySettingsUpdated({
                    ...DEFAULT_SETTINGS,
                    ...saved,
                });
            }
            await this.repairCrosswordStrategy(saved);
            if (saved.defaultExtractionMode !== "content") {
                throw new Error(
                    "Unsupported extraction mode. Reset settings to use 'content'.",
                );
            }
            this.settings = { ...DEFAULT_SETTINGS, ...saved };
            document.querySelector<HTMLInputElement>(
                `input[name="shoppingMode"][value="${this.settings.shoppingMode}"]`,
            )!.checked = true;
            document.querySelector<HTMLInputElement>(
                `input[name="crosswordMode"][value="${this.settings.crosswordMode}"]`,
            )!.checked = true;
            (
                document.getElementById(
                    "crosswordDecisionStrategy",
                ) as HTMLSelectElement
            ).value = this.settings.crosswordDecisionStrategy;

            // Update form fields
            (
                document.getElementById("agentServerHost") as HTMLInputElement
            ).value = this.settings.agentServerHost;
            (
                document.getElementById(
                    "maxConcurrentExtractions",
                ) as HTMLInputElement
            ).value = this.settings.maxConcurrentExtractions.toString();
            (
                document.getElementById("qualityThreshold") as HTMLInputElement
            ).value = this.settings.qualityThreshold.toString();

            // Auto-discovery settings
            const autoDiscoveryEl = document.getElementById(
                "autoDiscovery",
            ) as HTMLInputElement | null;
            if (autoDiscoveryEl) {
                autoDiscoveryEl.checked = this.settings.autoDiscovery;
            }
            const autoDiscoveryModeEl = document.getElementById(
                "autoDiscoveryMode",
            ) as HTMLSelectElement | null;
            if (autoDiscoveryModeEl) {
                autoDiscoveryModeEl.value = this.settings.autoDiscoveryMode;
            }
            const excludeSensitiveEl = document.getElementById(
                "excludeSensitiveSitesDiscovery",
            ) as HTMLInputElement | null;
            if (excludeSensitiveEl) {
                excludeSensitiveEl.checked =
                    this.settings.excludeSensitiveSites;
            }
            const autoOpenChatPanelEl = document.getElementById(
                "autoOpenChatPanel",
            ) as HTMLInputElement | null;
            if (autoOpenChatPanelEl) {
                autoOpenChatPanelEl.checked = this.settings.autoOpenChatPanel;
            }
            const caseInsensitiveWindowTitleMatchingEl =
                document.getElementById(
                    "caseInsensitiveWindowTitleMatching",
                ) as HTMLInputElement | null;
            if (caseInsensitiveWindowTitleMatchingEl) {
                caseInsensitiveWindowTitleMatchingEl.checked =
                    this.settings.caseInsensitiveWindowTitleMatching;
            }
        } catch (error) {
            console.error("Error loading settings:", error);
            this.showStatus("Error loading settings", "danger");
        }
    }

    private async checkCrosswordDecisionCapabilities() {
        try {
            const { rpc } = getChromeRpc();
            this.crosswordCapabilities = (await rpc.invoke(
                "getCrosswordDecisionCapabilities",
            )) as CrosswordDecisionCapabilities;
        } catch (error) {
            console.warn(
                "Could not check crossword decision capabilities:",
                error,
            );
            this.crosswordCapabilities = {
                available: false,
                configGeneration: "unavailable",
            };
        }
        this.updateCrosswordDecisionStatus();
    }

    private updateCrosswordDecisionStatus() {
        const status = document.getElementById("crosswordDecisionStatus")!;
        const capabilities = this.crosswordCapabilities;
        const selectedMode = this.getSelectedCrosswordMode();
        (
            document.getElementById(
                "crosswordDecisionStrategy",
            ) as HTMLSelectElement
        ).disabled = selectedMode !== "decision";
        status.className = `alert alert-${capabilities?.available ? "success" : "warning"}`;
        const availability = capabilities?.available
            ? "Crossword Decision available."
            : `Crossword Decision unavailable.${selectedMode === "decision" ? " Decision remains selected; crossword actions will not fall back to Generative." : " Generative is unaffected."}`;
        const details = [
            capabilities?.provider ? `Provider: ${capabilities.provider}` : "",
            capabilities?.model ? `Model: ${capabilities.model}` : "",
        ]
            .filter(Boolean)
            .join(" · ");
        status.textContent = `${availability}${details ? ` ${details}` : ""}`;
    }

    private getSelectedCrosswordMode() {
        return document.querySelector<HTMLInputElement>(
            'input[name="crosswordMode"]:checked',
        )?.value;
    }

    private getSelectedShoppingMode() {
        return document.querySelector<HTMLInputElement>(
            'input[name="shoppingMode"]:checked',
        )?.value;
    }

    private async repairShoppingMode(saved: Record<string, unknown>) {
        if (isShoppingMode(saved.shoppingMode)) return;
        console.warn("Invalid shopping mode; resetting to Generative.");
        saved.shoppingMode = DEFAULT_SETTINGS.shoppingMode;
        await chrome.storage.sync.set({ shoppingMode: saved.shoppingMode });
        this.showStatus(
            "Invalid Shopping Mode was reset to Generative.",
            "warning",
        );
        await this.notifySettingsUpdated({ ...DEFAULT_SETTINGS, ...saved });
    }

    private async repairCrosswordStrategy(saved: Record<string, unknown>) {
        if (isCrosswordDecisionStrategy(saved.crosswordDecisionStrategy))
            return;
        console.warn(
            "Invalid crossword Decision strategy; resetting to Hybrid.",
        );
        saved.crosswordDecisionStrategy =
            DEFAULT_SETTINGS.crosswordDecisionStrategy;
        await chrome.storage.sync.set({
            crosswordDecisionStrategy: saved.crosswordDecisionStrategy,
        });
        this.showStatus(
            "Invalid Crossword Decision strategy was reset to Hybrid.",
            "warning",
        );
        await this.notifySettingsUpdated({ ...DEFAULT_SETTINGS, ...saved });
    }

    private async checkAIModelStatus() {
        const statusContainer = document.getElementById("aiStatus")!;
        statusContainer.className = "ai-status ai-checking";
        statusContainer.innerHTML =
            '<i class="bi bi-hourglass-split"></i><span>Checking AI model availability...</span>';

        try {
            const { rpc } = getChromeRpc();
            const response = await (rpc as any).invoke(
                "checkAIModelAvailability",
                { type: "checkAIModelAvailability" },
            );

            this.aiStatus = {
                available: response.available || false,
                version: response.version,
                endpoint: response.endpoint,
                lastChecked: new Date().toISOString(),
            };
        } catch (error) {
            console.warn("Could not check AI model status:", error);
            this.aiStatus = { available: false };
        }

        this.updateAIStatusDisplay();
    }

    private updateAIStatusDisplay() {
        const statusContainer = document.getElementById("aiStatus")!;

        if (this.aiStatus.available) {
            statusContainer.className = "ai-status ai-available";
            statusContainer.innerHTML = `
                <i class="bi bi-check-circle"></i>
                <span>AI model available and ready</span>
            `;
        } else {
            statusContainer.className = "ai-status ai-unavailable";
            statusContainer.innerHTML = `
                <i class="bi bi-exclamation-triangle"></i>
                <span>AI model not available - content extraction requires a model</span>
            `;
        }
    }

    private updateRangeDisplays() {
        this.updateConcurrencyDisplay(this.settings.maxConcurrentExtractions);
        this.updateQualityDisplay(this.settings.qualityThreshold);
    }

    private updateConcurrencyDisplay(value: number) {
        document.getElementById("concurrencyValue")!.textContent =
            value.toString();
        this.settings.maxConcurrentExtractions = value;
    }

    private updateQualityDisplay(value: number) {
        document.getElementById("thresholdValue")!.textContent =
            value.toFixed(1);
        this.settings.qualityThreshold = value;
    }

    private async saveOptions(e: Event) {
        e.preventDefault();
        const shoppingMode = this.getSelectedShoppingMode();
        if (!isShoppingMode(shoppingMode)) {
            this.showStatus("Please select a valid Shopping Mode.", "warning");
            return;
        }
        const crosswordMode = this.getSelectedCrosswordMode();
        if (!isCrosswordMode(crosswordMode)) {
            this.showStatus("Please select a valid Crossword Mode.", "warning");
            return;
        }
        const strategy = (
            document.getElementById(
                "crosswordDecisionStrategy",
            ) as HTMLSelectElement
        ).value;
        if (!isCrosswordDecisionStrategy(strategy)) {
            this.showStatus(
                "Please select a valid Crossword Decision strategy.",
                "warning",
            );
            return;
        }

        // Validate WebSocket URL — blank means "use default agent-server
        // URL" (the service worker falls back to AGENT_SERVER_DEFAULT_URL).
        const agentServerHost = (
            document.getElementById("agentServerHost") as HTMLInputElement
        ).value.trim();
        if (
            agentServerHost !== "" &&
            !this.isValidWebSocketUrl(agentServerHost)
        ) {
            this.showStatus(
                "Please enter a valid WebSocket URL (ws:// or wss://) or leave blank",
                "danger",
            );
            return;
        }

        // Update settings
        this.settings.agentServerHost = agentServerHost;
        this.settings.shoppingMode = shoppingMode;
        this.settings.crosswordMode = crosswordMode;
        this.settings.crosswordDecisionStrategy = strategy;

        // Auto-discovery settings
        const autoDiscoveryEl = document.getElementById(
            "autoDiscovery",
        ) as HTMLInputElement | null;
        if (autoDiscoveryEl) {
            this.settings.autoDiscovery = autoDiscoveryEl.checked;
        }
        const autoDiscoveryModeEl = document.getElementById(
            "autoDiscoveryMode",
        ) as HTMLSelectElement | null;
        if (autoDiscoveryModeEl) {
            this.settings.autoDiscoveryMode = autoDiscoveryModeEl.value as
                | "scope"
                | "content";
        }
        const excludeSensitiveEl = document.getElementById(
            "excludeSensitiveSitesDiscovery",
        ) as HTMLInputElement | null;
        if (excludeSensitiveEl) {
            this.settings.excludeSensitiveSites = excludeSensitiveEl.checked;
        }
        const autoOpenChatPanelEl = document.getElementById(
            "autoOpenChatPanel",
        ) as HTMLInputElement | null;
        if (autoOpenChatPanelEl) {
            this.settings.autoOpenChatPanel = autoOpenChatPanelEl.checked;
        }
        const caseInsensitiveWindowTitleMatchingEl = document.getElementById(
            "caseInsensitiveWindowTitleMatching",
        ) as HTMLInputElement | null;
        if (caseInsensitiveWindowTitleMatchingEl) {
            this.settings.caseInsensitiveWindowTitleMatching =
                caseInsensitiveWindowTitleMatchingEl.checked;
        }

        try {
            await chrome.storage.sync.set(this.settings);
            await this.notifySettingsUpdated(this.settings);
            this.showStatus("Settings saved successfully!", "success");
        } catch (error) {
            console.error("Error saving settings:", error);
            this.showStatus("Error saving settings", "danger");
        }
    }

    private async resetToDefaults() {
        if (
            confirm("Are you sure you want to reset all settings to defaults?")
        ) {
            try {
                this.settings = { ...DEFAULT_SETTINGS };
                await chrome.storage.sync.set(this.settings);
                await this.notifySettingsUpdated(this.settings);
                await this.loadSavedSettings();
                this.updateRangeDisplays();
                this.updateCrosswordDecisionStatus();
                this.showStatus("Settings reset to defaults", "info");
            } catch (error) {
                console.error("Error resetting settings:", error);
                this.showStatus("Error resetting settings", "danger");
            }
        }
    }

    private exportSettings() {
        if (!isShoppingMode(this.settings.shoppingMode)) {
            this.showStatus(
                "Invalid Shopping Mode. Reload settings before exporting.",
                "warning",
            );
            return;
        }
        if (
            !isCrosswordDecisionStrategy(
                this.settings.crosswordDecisionStrategy,
            )
        ) {
            this.showStatus(
                "Invalid Crossword Decision strategy. Reload settings before exporting.",
                "warning",
            );
            return;
        }
        if (!isCrosswordMode(this.settings.crosswordMode)) {
            this.showStatus(
                "Invalid Crossword Mode. Reload settings before exporting.",
                "warning",
            );
            return;
        }
        const exportData = {
            ...this.settings,
            exportDate: new Date().toISOString(),
            version: "1.0",
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `typeagent-knowledge-settings-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showStatus("Settings exported successfully", "success");
    }

    private async notifySettingsUpdated(settings: ExtensionSettings) {
        const { rpc } = getChromeRpc();
        await rpc.invoke("settingsUpdated", {
            settings,
        });
    }

    private showStatus(
        message: string,
        type: "success" | "danger" | "info" | "warning",
    ) {
        const statusMessage = document.getElementById("statusMessage")!;
        statusMessage.textContent = message;
        statusMessage.className = `alert alert-${type}`;

        // Hide the message after 4 seconds
        setTimeout(() => {
            statusMessage.className = "alert d-none";
        }, 4000);
    }

    private isValidWebSocketUrl(url: string): boolean {
        return url.startsWith("ws://") || url.startsWith("wss://");
    }
}

// Initialize the options page
document.addEventListener("DOMContentLoaded", () => {
    const optionsPage = new EnhancedOptionsPage();
    optionsPage.initialize();
});
