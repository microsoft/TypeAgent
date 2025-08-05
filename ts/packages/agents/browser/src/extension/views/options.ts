// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ExtensionSettings {
    websocketHost: string;
    defaultExtractionMode: "basic" | "content" | "full";
    maxConcurrentExtractions: number;
    qualityThreshold: number;
    enableIntelligentAnalysis: boolean;
}

interface AIModelStatus {
    available: boolean;
    version?: string;
    endpoint?: string;
    lastChecked?: string;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
    websocketHost: "ws://localhost:8080/",
    defaultExtractionMode: "content",
    maxConcurrentExtractions: 3,
    qualityThreshold: 0.3,
    enableIntelligentAnalysis: true,
};

class EnhancedOptionsPage {
    private settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    private aiStatus: AIModelStatus = { available: false };

    constructor() {
        this.initializeEventListeners();
    }

    async initialize() {
        await this.loadSavedSettings();
        await this.checkAIModelStatus();
        this.updateModeUI();
        this.updateRangeDisplays();
        this.updateAIStatusDisplay();
    }

    private initializeEventListeners() {
        // Form submission
        const optionsForm = document.getElementById(
            "optionsForm",
        ) as HTMLFormElement;
        optionsForm.addEventListener("submit", (e) => this.saveOptions(e));

        // Mode selection
        document.querySelectorAll(".mode-option").forEach((option) => {
            option.addEventListener("click", (e) => {
                const mode = (e.currentTarget as HTMLElement).dataset
                    .mode as any;
                this.selectMode(mode);
            });
        });

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
            this.settings = { ...DEFAULT_SETTINGS, ...saved };

            // Update form fields
            (
                document.getElementById("websocketHost") as HTMLInputElement
            ).value = this.settings.websocketHost;
            (
                document.getElementById(
                    "maxConcurrentExtractions",
                ) as HTMLInputElement
            ).value = this.settings.maxConcurrentExtractions.toString();
            (
                document.getElementById("qualityThreshold") as HTMLInputElement
            ).value = this.settings.qualityThreshold.toString();
        } catch (error) {
            console.error("Error loading settings:", error);
            this.showStatus("Error loading settings", "danger");
        }
    }

    private async checkAIModelStatus() {
        const statusContainer = document.getElementById("aiStatus")!;
        statusContainer.className = "ai-status ai-checking";
        statusContainer.innerHTML =
            '<i class="bi bi-hourglass-split"></i><span>Checking AI model availability...</span>';

        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkAIModelAvailability",
            });

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
                <span>AI model not available - only Basic mode will work</span>
            `;
        }
    }

    private selectMode(mode: "basic" | "content" | "full") {
        // Update visual selection
        document.querySelectorAll(".mode-option").forEach((option) => {
            option.classList.remove("selected");
        });
        document
            .querySelector(`[data-mode="${mode}"]`)
            ?.classList.add("selected");

        // Update radio button
        (
            document.querySelector(`input[value="${mode}"]`) as HTMLInputElement
        ).checked = true;

        // Update settings
        this.settings.defaultExtractionMode = mode;
        this.settings.enableIntelligentAnalysis = mode !== "basic";

        // Show warning if AI required but not available
        if (mode !== "basic" && !this.aiStatus.available) {
            this.showStatus(
                `${mode} mode requires AI model but none is available. Consider using Basic mode.`,
                "warning",
            );
        }
    }

    private updateModeUI() {
        const selectedMode = this.settings.defaultExtractionMode;
        this.selectMode(selectedMode);
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

        // Validate WebSocket URL
        const websocketHost = (
            document.getElementById("websocketHost") as HTMLInputElement
        ).value.trim();
        if (!this.isValidWebSocketUrl(websocketHost)) {
            this.showStatus(
                "Please enter a valid WebSocket URL (ws:// or wss://)",
                "danger",
            );
            return;
        }

        // Update settings
        this.settings.websocketHost = websocketHost;

        // Get selected mode
        const selectedMode = document.querySelector(
            'input[name="defaultMode"]:checked',
        ) as HTMLInputElement;
        if (selectedMode) {
            this.settings.defaultExtractionMode = selectedMode.value as any;
        }

        try {
            await chrome.storage.sync.set(this.settings);
            this.showStatus("Settings saved successfully!", "success");

            // Notify background script of settings change
            chrome.runtime.sendMessage({
                type: "settingsUpdated",
                settings: this.settings,
            });
        } catch (error) {
            console.error("Error saving settings:", error);
            this.showStatus("Error saving settings", "danger");
        }
    }

    private async resetToDefaults() {
        if (
            confirm("Are you sure you want to reset all settings to defaults?")
        ) {
            this.settings = { ...DEFAULT_SETTINGS };
            await this.loadSavedSettings();
            this.updateModeUI();
            this.updateRangeDisplays();
            this.showStatus("Settings reset to defaults", "info");
        }
    }

    private exportSettings() {
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
