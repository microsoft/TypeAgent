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

interface SearchFilters {
    dateFrom?: string;
    dateTo?: string;
    sourceType?: "bookmarks" | "history";
    domain?: string;
    minRelevance?: number;
}

interface Website {
    url: string;
    title: string;
    domain: string;
    visitCount?: number;
    lastVisited?: string;
    source: "bookmarks" | "history";
    score?: number;
    snippet?: string;
}

interface SearchResult {
    websites: Website[];
    summary: {
        text: string;
        totalFound: number;
        searchTime: number;
        sources: SourceReference[];
        entities: EntityMatch[];
    };
    query: string;
    filters: SearchFilters;
}

interface SourceReference {
    url: string;
    title: string;
    relevance: number;
}

interface EntityMatch {
    entity: string;
    type: string;
    count: number;
}

interface SuggestedSearch {
    query: string;
    category: string;
    description: string;
    estimatedResults: number;
}

interface CategorySuggestions {
    recentFinds: SuggestedSearch[];
    popularDomains: SuggestedSearch[];
    exploreTopics: SuggestedSearch[];
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
    
    // Search-related properties
    private currentResults: Website[] = [];
    private currentViewMode: "list" | "card" | "timeline" | "domain" = "list";
    private searchDebounceTimer: number | null = null;
    private recentSearches: string[] = [];
    private currentQuery: string = "";

    async initialize() {
        console.log("Initializing Website Library Panel");

        this.setupEventListeners();
        this.setupSearchEventListeners();
        this.setupViewModeHandlers();
        await this.checkConnectionStatus();
        await this.loadLibraryStats();
        await this.loadImportHistory();
        await this.loadRecentSearches();
        await this.loadSuggestedSearches();
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

    private setupSearchEventListeners() {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        const searchButton = document.getElementById('searchButton')!;
        const voiceSearchButton = document.getElementById('voiceSearchButton')!;
        const relevanceFilter = document.getElementById('relevanceFilter') as HTMLInputElement;

        // Search input handlers
        searchInput.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.handleSearchInput(query);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        searchButton.addEventListener('click', () => {
            this.performSearch();
        });

        // Voice search (placeholder for future implementation)
        voiceSearchButton.addEventListener('click', () => {
            this.showNotification('Voice search not yet implemented', 'info');
        });

        // Relevance filter update
        relevanceFilter.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            document.getElementById('relevanceValue')!.textContent = `${value}%`;
        });

        // Filter change handlers
        ['dateFrom', 'dateTo', 'sourceFilter', 'domainFilter', 'relevanceFilter'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    if (this.currentQuery) {
                        this.performSearch();
                    }
                });
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            const suggestions = document.getElementById('searchSuggestions')!;
            if (!searchInput.contains(e.target as Node) && !suggestions.contains(e.target as Node)) {
                suggestions.classList.add('d-none');
            }
        });
    }

    private setupViewModeHandlers() {
        document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) {
                    this.currentViewMode = target.id.replace('View', '') as any;
                    this.rerenderResults();
                }
            });
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

    // Search-related methods
    private handleSearchInput(query: string) {
        this.currentQuery = query;
        
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (query.length >= 2) {
            this.searchDebounceTimer = window.setTimeout(() => {
                this.getSearchSuggestions(query);
            }, 300);
        } else {
            document.getElementById('searchSuggestions')!.classList.add('d-none');
        }
    }

    private async performSearch() {
        const query = this.currentQuery.trim();
        if (!query) {
            this.showNotification('Please enter a search query', 'info');
            return;
        }

        const searchButton = document.getElementById('searchButton') as HTMLButtonElement;
        const originalContent = searchButton.innerHTML;
        
        searchButton.innerHTML = '<i class="bi bi-hourglass-split"></i>';
        searchButton.disabled = true;

        try {
            const filters = this.getActiveFilters();
            const response = await chrome.runtime.sendMessage({
                type: 'searchWebsitesEnhanced',
                parameters: {
                    query: query,
                    filters: filters,
                    includeSummary: true,
                    limit: 50
                }
            });

            if (response.success) {
                this.renderSearchResults(response.results);
                await this.saveSearchToHistory(query);
                await this.loadRecentSearches();
            } else {
                this.showNotification(`Search failed: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showNotification('Search failed due to connection error', 'error');
        } finally {
            searchButton.innerHTML = originalContent;
            searchButton.disabled = false;
        }
    }

    private async getSearchSuggestions(query: string) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'getSearchSuggestions',
                parameters: { query: query, limit: 5 }
            });

            if (response.success && response.suggestions.length > 0) {
                this.renderSearchSuggestions(response.suggestions);
            } else {
                document.getElementById('searchSuggestions')!.classList.add('d-none');
            }
        } catch (error) {
            console.error('Error getting search suggestions:', error);
        }
    }

    private renderSearchSuggestions(suggestions: string[]) {
        const container = document.getElementById('searchSuggestions')!;
        
        container.innerHTML = suggestions.map(suggestion => `
            <div class="suggestion-item" onclick="libraryPanel.selectSuggestion('${suggestion.replace(/'/g, "\\'")}')">
                ${suggestion}
            </div>
        `).join('');
        
        container.classList.remove('d-none');
    }

    selectSuggestion(suggestion: string) {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        searchInput.value = suggestion;
        this.currentQuery = suggestion;
        document.getElementById('searchSuggestions')!.classList.add('d-none');
        this.performSearch();
    }

    private getActiveFilters(): SearchFilters {
        const dateFrom = (document.getElementById('dateFrom') as HTMLInputElement).value;
        const dateTo = (document.getElementById('dateTo') as HTMLInputElement).value;
        const sourceType = (document.getElementById('sourceFilter') as HTMLSelectElement).value;
        const domain = (document.getElementById('domainFilter') as HTMLInputElement).value;
        const relevance = parseInt((document.getElementById('relevanceFilter') as HTMLInputElement).value);

        const filters: SearchFilters = {};
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
        if (sourceType) filters.sourceType = sourceType as "bookmarks" | "history";
        if (domain) filters.domain = domain;
        if (relevance > 0) filters.minRelevance = relevance / 100;

        return filters;
    }

    private renderSearchResults(results: SearchResult) {
        this.currentResults = results.websites;
        
        // Show results card
        const resultsCard = document.getElementById('searchResultsCard')!;
        resultsCard.classList.remove('d-none');
        resultsCard.scrollIntoView({ behavior: 'smooth' });

        // Render summary
        this.renderResultsSummary(results);
        
        // Render AI summary if available
        if (results.summary.text) {
            this.renderAISummary(results.summary);
        }

        // Render results based on current view mode
        this.rerenderResults();
    }

    private renderResultsSummary(results: SearchResult) {
        const summaryContainer = document.getElementById('resultsSummary')!;
        
        summaryContainer.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${results.summary.totalFound}</strong> results found for 
                    <em>"${results.query}"</em>
                </div>
                <small class="text-muted">
                    Search completed in ${results.summary.searchTime}ms
                </small>
            </div>
        `;
    }

    private renderAISummary(summary: any) {
        const summaryContainer = document.getElementById('aiSummarySection')!;
        
        summaryContainer.innerHTML = `
            <div class="ai-summary">
                <h6><i class="bi bi-robot"></i> AI Summary</h6>
                <p class="mb-3">${summary.text}</p>
                ${summary.entities && summary.entities.length > 0 ? `
                    <div class="mb-2">
                        <strong>Key Entities:</strong><br>
                        ${summary.entities.map((entity: EntityMatch) => 
                            `<span class="entity-badge">${entity.entity} (${entity.count})</span>`
                        ).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        summaryContainer.classList.remove('d-none');
    }

    private rerenderResults() {
        if (this.currentResults.length === 0) return;

        const container = document.getElementById('searchResultsContainer')!;
        
        switch (this.currentViewMode) {
            case "list":
                container.innerHTML = this.renderListView(this.currentResults);
                break;
            case "card":
                container.innerHTML = this.renderCardView(this.currentResults);
                break;
            case "timeline":
                container.innerHTML = this.renderTimelineView(this.currentResults);
                break;
            case "domain":
                container.innerHTML = this.renderDomainView(this.currentResults);
                break;
        }
    }

    private renderListView(websites: Website[]): string {
        return websites.map(site => `
            <div class="search-result-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <img src="https://www.google.com/s2/favicons?domain=${site.domain}" 
                                 class="result-favicon" alt="favicon">
                            <a href="${site.url}" target="_blank" class="fw-semibold text-decoration-none">
                                ${site.title || site.url}
                            </a>
                            ${site.score ? `<span class="result-score ms-2">${Math.round(site.score * 100)}%</span>` : ''}
                        </div>
                        <div class="result-domain text-muted small mb-1">${site.domain}</div>
                        ${site.snippet ? `<p class="small mb-1">${site.snippet}</p>` : ''}
                        <div class="d-flex justify-content-between align-items-center">
                            <small class="text-muted">
                                ${site.source === 'bookmarks' ? 'Bookmark' : 'History'} 
                                ${site.visitCount ? `• ${site.visitCount} visits` : ''}
                                ${site.lastVisited ? `• ${new Date(site.lastVisited).toLocaleDateString()}` : ''}
                            </small>
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-primary btn-sm" onclick="window.open('${site.url}', '_blank')">
                                    <i class="bi bi-box-arrow-up-right"></i> Open
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    private renderCardView(websites: Website[]): string {
        return `
            <div class="row">
                ${websites.map(site => `
                    <div class="col-md-6 col-lg-4 mb-3">
                        <div class="card result-card h-100">
                            <div class="card-body">
                                <div class="d-flex align-items-center mb-2">
                                    <img src="https://www.google.com/s2/favicons?domain=${site.domain}" 
                                         class="result-favicon" alt="favicon">
                                    <h6 class="card-title mb-0 text-truncate">${site.title || site.url}</h6>
                                </div>
                                <p class="card-text small text-muted">${site.domain}</p>
                                ${site.snippet ? `<p class="card-text small">${site.snippet.substring(0, 120)}...</p>` : ''}
                                <div class="mt-auto">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <small class="text-muted">${site.source}</small>
                                        ${site.score ? `<span class="result-score">${Math.round(site.score * 100)}%</span>` : ''}
                                    </div>
                                    <button class="btn btn-primary btn-sm w-100 mt-2" onclick="window.open('${site.url}', '_blank')">
                                        <i class="bi bi-box-arrow-up-right"></i> Open
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    private renderTimelineView(websites: Website[]): string {
        const sortedSites = [...websites].sort((a, b) => {
            const dateA = a.lastVisited ? new Date(a.lastVisited).getTime() : 0;
            const dateB = b.lastVisited ? new Date(b.lastVisited).getTime() : 0;
            return dateB - dateA;
        });

        return sortedSites.map(site => `
            <div class="timeline-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <img src="https://www.google.com/s2/favicons?domain=${site.domain}" 
                                 class="result-favicon" alt="favicon">
                            <a href="${site.url}" target="_blank" class="fw-semibold text-decoration-none">
                                ${site.title || site.url}
                            </a>
                        </div>
                        <div class="result-domain text-muted small">${site.domain}</div>
                        ${site.lastVisited ? `
                            <div class="text-muted small">
                                <i class="bi bi-clock"></i> ${new Date(site.lastVisited).toLocaleString()}
                            </div>
                        ` : ''}
                    </div>
                    ${site.score ? `<span class="result-score">${Math.round(site.score * 100)}%</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    private renderDomainView(websites: Website[]): string {
        const domainGroups = websites.reduce((groups, site) => {
            if (!groups[site.domain]) {
                groups[site.domain] = [];
            }
            groups[site.domain].push(site);
            return groups;
        }, {} as Record<string, Website[]>);

        return Object.entries(domainGroups).map(([domain, sites]) => `
            <div class="domain-group">
                <div class="domain-header">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                                 class="result-favicon" alt="favicon">
                            <h6 class="mb-0">${domain}</h6>
                        </div>
                        <span class="badge bg-secondary">${sites.length} ${sites.length === 1 ? 'page' : 'pages'}</span>
                    </div>
                </div>
                ${sites.map(site => `
                    <div class="search-result-item">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="flex-grow-1">
                                <a href="${site.url}" target="_blank" class="fw-semibold text-decoration-none">
                                    ${site.title || site.url}
                                </a>
                                <div class="small text-muted">
                                    ${site.source} ${site.visitCount ? `• ${site.visitCount} visits` : ''}
                                </div>
                            </div>
                            ${site.score ? `<span class="result-score">${Math.round(site.score * 100)}%</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    private async saveSearchToHistory(query: string) {
        try {
            await chrome.runtime.sendMessage({
                type: 'saveSearchHistory',
                query: query
            });
        } catch (error) {
            console.error('Error saving search to history:', error);
        }
    }

    private async loadRecentSearches() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'getSearchHistory'
            });

            if (response.success) {
                this.recentSearches = response.searches || [];
                this.renderRecentSearches();
            }
        } catch (error) {
            console.error('Error loading recent searches:', error);
        }
    }

    private renderRecentSearches() {
        const container = document.getElementById('recentSearchesList')!;
        
        if (this.recentSearches.length === 0) {
            container.innerHTML = '<span class="text-muted">No recent searches</span>';
            return;
        }

        container.innerHTML = this.recentSearches.slice(0, 5).map(search => `
            <span class="recent-search-tag" onclick="libraryPanel.selectRecentSearch('${search.replace(/'/g, "\\'")}')">
                ${search}
            </span>
        `).join('');
    }

    selectRecentSearch(query: string) {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        searchInput.value = query;
        this.currentQuery = query;
        this.performSearch();
    }

    private async loadSuggestedSearches() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'getSuggestedSearches'
            });

            if (response.success) {
                this.renderSuggestedSearches(response.suggestions);
            }
        } catch (error) {
            console.error('Error loading suggested searches:', error);
        }
    }

    private renderSuggestedSearches(suggestions: CategorySuggestions) {
        this.renderSuggestionCategory('recentFindsContainer', suggestions.recentFinds);
        this.renderSuggestionCategory('popularDomainsContainer', suggestions.popularDomains);
        this.renderSuggestionCategory('exploreTopicsContainer', suggestions.exploreTopics);
    }

    private renderSuggestionCategory(containerId: string, suggestions: SuggestedSearch[]) {
        const container = document.getElementById(containerId)!;
        
        if (suggestions.length === 0) {
            container.innerHTML = '<div class="text-muted small">Import data to see suggestions</div>';
            return;
        }

        container.innerHTML = suggestions.slice(0, 3).map(suggestion => `
            <div class="suggested-search-item" onclick="libraryPanel.selectSuggestedSearch('${suggestion.query.replace(/'/g, "\\'")}')">
                <div class="fw-semibold">${suggestion.query}</div>
                <div class="small text-muted">${suggestion.description}</div>
                <div class="small text-muted">${suggestion.estimatedResults} results</div>
            </div>
        `).join('');
    }

    selectSuggestedSearch(query: string) {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        searchInput.value = query;
        this.currentQuery = query;
        this.performSearch();
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
