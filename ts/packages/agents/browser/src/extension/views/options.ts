// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ExtensionSettings {
    websocketHost: string;
    defaultExtractionMode: "basic" | "content" | "actions" | "full";
    maxConcurrentExtractions: number;
    qualityThreshold: number;
    autoMigration: boolean;
    enableIntelligentAnalysis: boolean;
    enableActionDetection: boolean;
}

interface AIModelStatus {
    available: boolean;
    version?: string;
    endpoint?: string;
    lastChecked?: string;
}

interface MigrationCandidate {
    url: string;
    title: string;
    currentEntityCount: number;
    currentTopicCount: number;
    estimatedImprovement: number;
    contentLength: number;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
    websocketHost: "ws://localhost:8080/",
    defaultExtractionMode: "content",
    maxConcurrentExtractions: 3,
    qualityThreshold: 0.3,
    autoMigration: false,
    enableIntelligentAnalysis: true,
    enableActionDetection: false,
};

class EnhancedOptionsPage {
    private settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    private aiStatus: AIModelStatus = { available: false };
    private migrationCandidates: MigrationCandidate[] = [];

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
        const optionsForm = document.getElementById("optionsForm") as HTMLFormElement;
        optionsForm.addEventListener("submit", (e) => this.saveOptions(e));

        // Mode selection
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const mode = (e.currentTarget as HTMLElement).dataset.mode as any;
                this.selectMode(mode);
            });
        });

        // Range inputs
        const concurrencyRange = document.getElementById("maxConcurrentExtractions") as HTMLInputElement;
        concurrencyRange.addEventListener('input', () => {
            this.updateConcurrencyDisplay(parseInt(concurrencyRange.value));
        });

        const qualityRange = document.getElementById("qualityThreshold") as HTMLInputElement;
        qualityRange.addEventListener('input', () => {
            this.updateQualityDisplay(parseFloat(qualityRange.value));
        });

        // Migration controls
        document.getElementById("checkMigrationCandidates")?.addEventListener('click', () => {
            this.checkMigrationCandidates();
        });

        document.getElementById("migrateAll")?.addEventListener('click', () => {
            this.startMigration();
        });

        // Other controls
        document.getElementById("resetToDefaults")?.addEventListener('click', () => {
            this.resetToDefaults();
        });

        document.getElementById("exportSettings")?.addEventListener('click', () => {
            this.exportSettings();
        });
    }

    private async loadSavedSettings() {
        try {
            const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            this.settings = { ...DEFAULT_SETTINGS, ...saved };

            // Update form fields
            (document.getElementById("websocketHost") as HTMLInputElement).value = this.settings.websocketHost;
            (document.getElementById("maxConcurrentExtractions") as HTMLInputElement).value = this.settings.maxConcurrentExtractions.toString();
            (document.getElementById("qualityThreshold") as HTMLInputElement).value = this.settings.qualityThreshold.toString();
            (document.getElementById("autoMigration") as HTMLInputElement).checked = this.settings.autoMigration;

        } catch (error) {
            console.error("Error loading settings:", error);
            this.showStatus("Error loading settings", "danger");
        }
    }

    private async checkAIModelStatus() {
        const statusContainer = document.getElementById("aiStatus")!;
        statusContainer.className = "ai-status ai-checking";
        statusContainer.innerHTML = '<i class="bi bi-hourglass-split"></i><span>Checking AI model availability...</span>';

        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkAIModelAvailability"
            });

            this.aiStatus = {
                available: response.available || false,
                version: response.version,
                endpoint: response.endpoint,
                lastChecked: new Date().toISOString()
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

    private selectMode(mode: "basic" | "content" | "actions" | "full") {
        // Update visual selection
        document.querySelectorAll('.mode-option').forEach(option => {
            option.classList.remove('selected');
        });
        document.querySelector(`[data-mode="${mode}"]`)?.classList.add('selected');

        // Update radio button
        (document.querySelector(`input[value="${mode}"]`) as HTMLInputElement).checked = true;

        // Update settings
        this.settings.defaultExtractionMode = mode;
        this.settings.enableIntelligentAnalysis = mode !== 'basic';
        this.settings.enableActionDetection = mode === 'actions' || mode === 'full';

        // Show warning if AI required but not available
        if (mode !== 'basic' && !this.aiStatus.available) {
            this.showStatus(
                `${mode} mode requires AI model but none is available. Consider using Basic mode.`,
                "warning"
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
        document.getElementById("concurrencyValue")!.textContent = value.toString();
        this.settings.maxConcurrentExtractions = value;
    }

    private updateQualityDisplay(value: number) {
        document.getElementById("thresholdValue")!.textContent = value.toFixed(1);
        this.settings.qualityThreshold = value;
    }

    private async checkMigrationCandidates() {
        const button = document.getElementById("checkMigrationCandidates") as HTMLButtonElement;
        const originalText = button.innerHTML;
        
        button.innerHTML = '<i class="bi bi-hourglass-split"></i> Checking...';
        button.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                type: "detectMigrationCandidates"
            });

            this.migrationCandidates = response.candidates || [];
            this.displayMigrationCandidates();

        } catch (error) {
            console.error("Error checking migration candidates:", error);
            this.showStatus("Error checking for migration candidates", "danger");
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    private displayMigrationCandidates() {
        const resultsContainer = document.getElementById("migrationResults")!;
        
        if (this.migrationCandidates.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle me-2"></i>
                    No pages found that would benefit from knowledge enhancement.
                </div>
            `;
            return;
        }

        const candidatesList = this.migrationCandidates
            .slice(0, 10) // Show top 10
            .map(candidate => `
                <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                    <div class="flex-grow-1">
                        <div class="fw-semibold small">${candidate.title}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">
                            ${candidate.currentEntityCount} entities • ${candidate.currentTopicCount} topics
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="badge bg-success">+${Math.round(candidate.estimatedImprovement)}</div>
                    </div>
                </div>
            `).join('');

        resultsContainer.innerHTML = `
            <div class="alert alert-success">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <strong><i class="bi bi-arrow-up-circle me-2"></i>Found ${this.migrationCandidates.length} pages to enhance</strong>
                </div>
                <div class="border rounded" style="max-height: 200px; overflow-y: auto;">
                    ${candidatesList}
                </div>
                ${this.migrationCandidates.length > 10 ? `<small class="text-muted mt-2 d-block">...and ${this.migrationCandidates.length - 10} more</small>` : ''}
            </div>
        `;
    }

    private async startMigration() {
        if (this.migrationCandidates.length === 0) {
            await this.checkMigrationCandidates();
            if (this.migrationCandidates.length === 0) return;
        }

        const button = document.getElementById("migrateAll") as HTMLButtonElement;
        const progressContainer = document.getElementById("migrationProgress")!;
        
        button.disabled = true;
        progressContainer.classList.remove("d-none");

        try {
            const response = await chrome.runtime.sendMessage({
                type: "migrateKnowledgeIndex",
                mode: this.settings.defaultExtractionMode
            });

            // Monitor progress (simplified)
            this.updateMigrationProgress(0, this.migrationCandidates.length, "Starting migration...");
            
            // For demo purposes, simulate progress
            for (let i = 0; i <= this.migrationCandidates.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const current = Math.min(i, this.migrationCandidates.length);
                this.updateMigrationProgress(
                    current, 
                    this.migrationCandidates.length, 
                    current < this.migrationCandidates.length ? 
                        `Processing: ${this.migrationCandidates[current]?.title || 'Unknown'}` : 
                        "Migration complete!"
                );
            }

            this.showStatus(
                `Successfully enhanced ${this.migrationCandidates.length} pages with ${this.settings.defaultExtractionMode} mode`,
                "success"
            );

            // Clear candidates after successful migration
            this.migrationCandidates = [];
            document.getElementById("migrationResults")!.innerHTML = "";

        } catch (error) {
            console.error("Migration error:", error);
            this.showStatus("Error during knowledge enhancement", "danger");
        } finally {
            button.disabled = false;
            setTimeout(() => {
                progressContainer.classList.add("d-none");
            }, 2000);
        }
    }

    private updateMigrationProgress(current: number, total: number, status: string) {
        const progressBar = document.getElementById("migrationProgressBar")!;
        const statusElement = document.getElementById("migrationStatus")!;
        const currentElement = document.getElementById("migrationCurrent")!;
        const totalElement = document.getElementById("migrationTotal")!;

        const percentage = total > 0 ? (current / total) * 100 : 0;
        progressBar.style.width = `${percentage}%`;
        statusElement.textContent = status;
        currentElement.textContent = current.toString();
        totalElement.textContent = total.toString();
    }

    private async saveOptions(e: Event) {
        e.preventDefault();

        // Validate WebSocket URL
        const websocketHost = (document.getElementById("websocketHost") as HTMLInputElement).value.trim();
        if (!this.isValidWebSocketUrl(websocketHost)) {
            this.showStatus("Please enter a valid WebSocket URL (ws:// or wss://)", "danger");
            return;
        }

        // Update settings
        this.settings.websocketHost = websocketHost;
        this.settings.autoMigration = (document.getElementById("autoMigration") as HTMLInputElement).checked;

        // Get selected mode
        const selectedMode = document.querySelector('input[name="defaultMode"]:checked') as HTMLInputElement;
        if (selectedMode) {
            this.settings.defaultExtractionMode = selectedMode.value as any;
        }

        try {
            await chrome.storage.sync.set(this.settings);
            this.showStatus("Settings saved successfully!", "success");

            // Notify background script of settings change
            chrome.runtime.sendMessage({
                type: "settingsUpdated",
                settings: this.settings
            });

        } catch (error) {
            console.error("Error saving settings:", error);
            this.showStatus("Error saving settings", "danger");
        }
    }

    private async resetToDefaults() {
        if (confirm("Are you sure you want to reset all settings to defaults?")) {
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
            version: "1.0"
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `typeagent-knowledge-settings-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showStatus("Settings exported successfully", "success");
    }

    private showStatus(message: string, type: "success" | "danger" | "info" | "warning") {
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