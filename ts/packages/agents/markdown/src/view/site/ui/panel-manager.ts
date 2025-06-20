// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class PanelManager {
    public async initialize(): Promise<void> {
        // No initialization needed
    }

    public showCollaborationStatus(status: string): void {
        const statusElement = document.getElementById("collaboration-status");
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.style.display = "block";

            // Auto-hide after 3 seconds for success messages
            if (
                status.includes("Connected") ||
                status.includes("synchronized")
            ) {
                setTimeout(() => {
                    statusElement.style.display = "none";
                }, 3000);
            }
        }
    }

    public hideCollaborationStatus(): void {
        const statusElement = document.getElementById("collaboration-status");
        if (statusElement) {
            statusElement.style.display = "none";
        }
    }
}
