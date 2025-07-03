// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ImportOptions {
    source: "chrome" | "edge";
    type: "bookmarks" | "history";
    limit?: number;
    days?: number;
    folder?: string;
    includePageContent?: boolean;
    includeActions?: boolean;
}

interface ImportHistoryItem {
    id: string;
    timestamp: number;
    source: string;
    type: string;
    itemCount: number;
    status: "success" | "error" | "importing";
    options: ImportOptions;
    error?: string;
}

interface LibraryStats {
    totalWebsites: number;
    totalBookmarks: number;
    totalHistory: number;
    topDomains: number;
    lastImport?: number;
}

interface ImportProgressData {
    current: number;
    total: number;
    item: string;
    estimatedTimeRemaining?: number;
    itemsPerSecond?: number;
}

class WebsiteLibraryPanel {
    private isConnected: boolean = false;
    private currentImport: {
        id: string;
        startTime: number;
        cancelled: boolean;
    } | null = null;
    private selectedBrowser: string = "";
    private selectedType: string = "";

    async initialize() {
        console.log("Initializing Website Library Panel");

        this.setupEventListeners();
        await this.checkConnectionStatus();
        await this.loadLibraryStats();
        await this.loadImportHistory();
    }

    private setupEventListeners() {
        document.querySelectorAll('[data-browser]').forEach(option => {
            option.addEventListener('click', () => {
                this.selectBrowser(option.getAttribute('data-browser')!);
            });
        });

        document.querySelectorAll('[data-type]').forEach(option => {
            option.addEventListener('click', () => {
                this.selectDataType(option.getAttribute('data-type')!);
            });
        });

        document.getElementById('startImport')!.addEventListener('click', () => {
            this.startImport();
        });

        document.getElementById('cancelImport')!.addEventListener('click', () => {
            this.cancelImport();
        });

        document.getElementById('refreshLibrary')!.addEventListener('click', () => {
            this.refreshLibrary();
        });

        document.getElementById('exportLibrary')!.addEventListener('click', () => {
            this.exportLibrary();
        });

        document.getElementById('clearLibrary')!.addEventListener('click', () => {
            this.clearLibrary();
        });

        document.getElementById('clearImportHistory')!.addEventListener('click', () => {
            this.clearImportHistory();
        });

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'importProgress') {
                this.updateImportProgress(message.data);
            }
        });
    }

    private selectBrowser(browser: string) {
        document.querySelectorAll('[data-browser]').forEach(option => {
            option.classList.remove('selected');
        });
        document.querySelector(`[data-browser="${browser}"]`)!.classList.add('selected');
        this.selectedBrowser = browser;
        this.updateImportButton();
    }

    private selectDataType(type: string) {
        document.querySelectorAll('[data-type]').forEach(option => {
            option.classList.remove('selected');
        });
        document.querySelector(`[data-type="${type}"]`)!.classList.add('selected');
        this.selectedType = type;
        
        const daysContainer = document.getElementById('daysBackContainer')!;
        const folderContainer = document.getElementById('folderContainer')!;
        
        if (type === 'history') {
            daysContainer.style.display = 'block';
            folderContainer.style.display = 'none';
        } else {
            daysContainer.style.display = 'none';
            folderContainer.style.display = 'block';
        }
        
        this.updateImportButton();
    }

    private updateImportButton() {
        const startButton = document.getElementById('startImport') as HTMLButtonElement;
        startButton.disabled = !this.selectedBrowser || !this.selectedType;
    }

    private async startImport() {
        if (!this.selectedBrowser || !this.selectedType) {
            this.showNotification('Please select both browser and data type', 'error');
            return;
        }

        const options: ImportOptions = {
            source: this.selectedBrowser as "chrome" | "edge",
            type: this.selectedType as "bookmarks" | "history"
        };

        const limitInput = document.getElementById('importLimit') as HTMLInputElement;
        if (limitInput.value) {
            options.limit = parseInt(limitInput.value);
        }

        const daysInput = document.getElementById('daysBack') as HTMLInputElement;
        if (daysInput.value && this.selectedType === 'history') {
            options.days = parseInt(daysInput.value);
        }

        const folderInput = document.getElementById('bookmarkFolder') as HTMLInputElement;
        if (folderInput.value && this.selectedType === 'bookmarks') {
            options.folder = folderInput.value;
        }

        const includeContentCheckbox = document.getElementById('includePageContent') as HTMLInputElement;
        options.includePageContent = includeContentCheckbox.checked;

        const includeActionsCheckbox = document.getElementById('includeActions') as HTMLInputElement;
        options.includeActions = includeActionsCheckbox.checked;

        this.showImportProgress();
        
        this.currentImport = {
            id: this.generateImportId(),
            startTime: Date.now(),
            cancelled: false
        };

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'importWebsiteDataWithProgress',
                parameters: options,
                importId: this.currentImport.id
            });

            if (response.success) {
                await this.completeImport(response.itemCount);
                this.showNotification(`Successfully imported ${response.itemCount} items`, 'success');
            } else {
                await this.failImport(response.error);
                this.showNotification(`Import failed: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Import error:', error);
            await this.failImport(error instanceof Error ? error.message : 'Unknown error');
            this.showNotification('Import failed due to connection error', 'error');
        }
    }

    private async cancelImport() {
        if (this.currentImport) {
            this.currentImport.cancelled = true;
            
            try {
                await chrome.runtime.sendMessage({
                    type: 'cancelImport',
                    importId: this.currentImport.id
                });
            } catch (error) {
                console.error('Error cancelling import:', error);
            }
            
            await this.failImport('Cancelled by user');
            this.showNotification('Import cancelled', 'info');
        }
    }

    private showImportProgress() {
        document.getElementById('importForm')!.classList.add('d-none');
        document.getElementById('importProgress')!.classList.remove('d-none');
        
        const connectionStatus = document.getElementById('connectionStatus')!;
        connectionStatus.innerHTML = `
            <span class="status-indicator status-importing"></span>
            Importing data...
        `;
    }

    private hideImportProgress() {
        document.getElementById('importForm')!.classList.remove('d-none');
        document.getElementById('importProgress')!.classList.add('d-none');
        
        this.currentImport = null;
        this.updateConnectionStatus();
    }

    private updateImportProgress(data: ImportProgressData) {
        if (!this.currentImport || this.currentImport.cancelled) {
            return;
        }

        const progressBar = document.getElementById('progressBar')!;
        const progressStats = document.getElementById('progressStats')!;
        const currentItem = document.getElementById('currentItem')!;
        const itemsProcessed = document.getElementById('itemsProcessed')!;
        const estimatedTime = document.getElementById('estimatedTime')!;
        const importSpeed = document.getElementById('importSpeed')!;

        const percentage = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
        
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage.toString());
        
        progressStats.textContent = `${data.current} / ${data.total} items`;
        currentItem.textContent = `Processing: ${data.item.substring(0, 60)}${data.item.length > 60 ? '...' : ''}`;
        itemsProcessed.textContent = data.current.toString();
        
        if (data.estimatedTimeRemaining) {
            estimatedTime.textContent = this.formatTime(data.estimatedTimeRemaining);
        }
        
        if (data.itemsPerSecond) {
            importSpeed.textContent = data.itemsPerSecond.toFixed(1);
        }
    }

    private async completeImport(itemCount: number) {
        const historyItem: ImportHistoryItem = {
            id: this.currentImport!.id,
            timestamp: this.currentImport!.startTime,
            source: this.selectedBrowser,
            type: this.selectedType,
            itemCount: itemCount,
            status: 'success',
            options: this.getImportOptions()
        };

        await this.addToImportHistory(historyItem);
        this.hideImportProgress();
        await this.loadLibraryStats();
        await this.loadImportHistory();
    }

    private async failImport(error: string) {
        const historyItem: ImportHistoryItem = {
            id: this.currentImport!.id,
            timestamp: this.currentImport!.startTime,
            source: this.selectedBrowser,
            type: this.selectedType,
            itemCount: 0,
            status: 'error',
            options: this.getImportOptions(),
            error: error
        };

        await this.addToImportHistory(historyItem);
        this.hideImportProgress();
        await this.loadImportHistory();
    }

    private getImportOptions(): ImportOptions {
        const limitInput = document.getElementById('importLimit') as HTMLInputElement;
        const daysInput = document.getElementById('daysBack') as HTMLInputElement;
        const folderInput = document.getElementById('bookmarkFolder') as HTMLInputElement;
        const includeContentCheckbox = document.getElementById('includePageContent') as HTMLInputElement;
        const includeActionsCheckbox = document.getElementById('includeActions') as HTMLInputElement;

        const options: ImportOptions = {
            source: this.selectedBrowser as "chrome" | "edge",
            type: this.selectedType as "bookmarks" | "history"
        };

        if (limitInput.value) options.limit = parseInt(limitInput.value);
        if (daysInput.value && this.selectedType === 'history') options.days = parseInt(daysInput.value);
        if (folderInput.value && this.selectedType === 'bookmarks') options.folder = folderInput.value;
        options.includePageContent = includeContentCheckbox.checked;
        options.includeActions = includeActionsCheckbox.checked;

        return options;
    }

    private async loadLibraryStats() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'getWebsiteLibraryStats'
            });

            if (response.success) {
                this.renderLibraryStats(response.stats);
            } else {
                console.error('Failed to load library stats:', response.error);
            }
        } catch (error) {
            console.error('Error loading library stats:', error);
            this.renderLibraryStats({
                totalWebsites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                topDomains: 0
            });
        }
    }

    private renderLibraryStats(stats: LibraryStats) {
        document.getElementById('totalWebsites')!.textContent = stats.totalWebsites.toString();
        document.getElementById('totalBookmarks')!.textContent = stats.totalBookmarks.toString();
        document.getElementById('totalHistory')!.textContent = stats.totalHistory.toString();
        document.getElementById('topDomains')!.textContent = stats.topDomains.toString();

        const emptyState = document.getElementById('emptyLibraryState')!;
        const libraryActions = document.getElementById('libraryActions')!;

        if (stats.totalWebsites === 0) {
            emptyState.classList.remove('d-none');
            libraryActions.classList.add('d-none');
        } else {
            emptyState.classList.add('d-none');
            libraryActions.classList.remove('d-none');
        }
    }

    private async loadImportHistory() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'getImportHistory'
            });

            if (response.success) {
                this.renderImportHistory(response.history);
            } else {
                console.error('Failed to load import history:', response.error);
            }
        } catch (error) {
            console.error('Error loading import history:', error);
            this.renderImportHistory([]);
        }
    }

    private renderImportHistory(history: ImportHistoryItem[]) {
        const container = document.getElementById('importHistoryContainer')!;

        if (history.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-clock-history"></i>
                    <p class="mb-0">No imports yet</p>
                    <small class="text-muted">Your import history will appear here</small>
                </div>
            `;
            return;
        }

        container.innerHTML = history.map(item => `
            <div class="import-history-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <i class="bi bi-${item.type === 'bookmarks' ? 'bookmark-star' : 'clock-history'} me-2"></i>
                            <span class="fw-semibold">${item.source} ${item.type}</span>
                            <span class="import-status status-${item.status} ms-2">${item.status}</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <small class="text-muted">
                                ${new Date(item.timestamp).toLocaleString()} • ${item.itemCount} items
                            </small>
                            <button class="btn btn-outline-danger btn-sm" onclick="libraryPanel.deleteImportHistoryItem('${item.id}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                        ${item.error ? `<small class="text-danger mt-1 d-block">Error: ${item.error}</small>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    private async addToImportHistory(item: ImportHistoryItem) {
        try {
            await chrome.runtime.sendMessage({
                type: 'addImportHistoryItem',
                item: item
            });
        } catch (error) {
            console.error('Error adding import history item:', error);
        }
    }

    async deleteImportHistoryItem(id: string) {
        if (!confirm('Are you sure you want to delete this import history item?')) {
            return;
        }

        try {
            await chrome.runtime.sendMessage({
                type: 'deleteImportHistoryItem',
                id: id
            });
            await this.loadImportHistory();
        } catch (error) {
            console.error('Error deleting import history item:', error);
            this.showNotification('Failed to delete import history item', 'error');
        }
    }

    private async refreshLibrary() {
        const button = document.getElementById('refreshLibrary') as HTMLButtonElement;
        const originalContent = button.innerHTML;
        
        button.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> Refreshing...';
        button.disabled = true;

        try {
            await this.loadLibraryStats();
            await this.loadImportHistory();
            this.showNotification('Library refreshed successfully', 'success');
        } catch (error) {
            console.error('Error refreshing library:', error);
            this.showNotification('Failed to refresh library', 'error');
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }

    private async exportLibrary() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'exportWebsiteLibrary'
            });

            if (response.success) {
                const blob = new Blob([JSON.stringify(response.data, null, 2)], { 
                    type: 'application/json' 
                });
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.href = url;
                link.download = `website-library-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                URL.revokeObjectURL(url);
                this.showNotification('Library exported successfully', 'success');
            } else {
                this.showNotification(`Export failed: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Error exporting library:', error);
            this.showNotification('Failed to export library', 'error');
        }
    }

    private async clearLibrary() {
        const confirmed = confirm(
            'Are you sure you want to clear all library data? This action cannot be undone.'
        );
        
        if (!confirmed) return;

        const secondConfirm = confirm(
            'This will permanently delete all imported bookmarks and history data. Continue?'
        );
        
        if (!secondConfirm) return;

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'clearWebsiteLibrary'
            });

            if (response.success) {
                await this.loadLibraryStats();
                await this.loadImportHistory();
                this.showNotification('Library cleared successfully', 'success');
            } else {
                this.showNotification(`Failed to clear library: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Error clearing library:', error);
            this.showNotification('Failed to clear library', 'error');
        }
    }

    private async clearImportHistory() {
        if (!confirm('Are you sure you want to clear the import history?')) {
            return;
        }

        try {
            await chrome.runtime.sendMessage({
                type: 'clearImportHistory'
            });
            await this.loadImportHistory();
            this.showNotification('Import history cleared', 'success');
        } catch (error) {
            console.error('Error clearing import history:', error);
            this.showNotification('Failed to clear import history', 'error');
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'checkConnection'
            });

            this.isConnected = response.connected;
            this.updateConnectionStatus();
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById('connectionStatus')!;
        const indicator = statusElement.querySelector('.status-indicator')!;

        if (this.isConnected) {
            indicator.className = 'status-indicator status-connected';
            statusElement.innerHTML = `
                <span class="status-indicator status-connected"></span>
                Connected to TypeAgent
            `;
        } else {
            indicator.className = 'status-indicator status-disconnected';
            statusElement.innerHTML = `
                <span class="status-indicator status-disconnected"></span>
                Disconnected from TypeAgent
            `;
        }
    }

    private generateImportId(): string {
        return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.round((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    private showNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
        const alertClass = `alert-${type === 'error' ? 'danger' : type}`;
        const iconClass = 
            type === 'success' ? 'bi-check-circle' :
            type === 'error' ? 'bi-exclamation-triangle' :
            'bi-info-circle';

        const notification = document.createElement('div');
        notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        notification.style.cssText = 'top: 1rem; right: 1rem; z-index: 1050; min-width: 300px;';
        notification.innerHTML = `
            <i class="${iconClass} me-2"></i>${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }
}

// Global instance for HTML onclick handlers
let libraryPanel: WebsiteLibraryPanel;

// Initialize the panel when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    libraryPanel = new WebsiteLibraryPanel();
    await libraryPanel.initialize();
});

// Add CSS for spin animation
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .spin {
        animation: spin 1s linear infinite;
    }
`;
document.head.appendChild(style);
