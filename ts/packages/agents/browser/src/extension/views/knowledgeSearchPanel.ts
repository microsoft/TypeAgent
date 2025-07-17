import { SearchServices, SearchResult, Website, EntityMatch } from './knowledgeUtilities';

export class KnowledgeSearchPanel {
    private container: HTMLElement;
    private services: SearchServices;
    private currentQuery: string = '';
    private currentFilters: any = {};
    private currentResults: SearchResult | null = null;
    private searchDebounceTimer: number | null = null;
    private currentViewMode: 'list' | 'grid' | 'timeline' | 'domain' = 'list';
    private recentSearches: string[] = [];

    constructor(container: HTMLElement, services: SearchServices) {
        this.container = container;
        this.services = services;
        this.loadRecentSearches();
    }

    async initialize(): Promise<void> {
        this.setupEventListeners();
        this.updateRecentSearchesDisplay();
    }

    async performSearch(query: string, filters?: any): Promise<void> {
        if (!query?.trim()) return;
        
        console.log('KnowledgeSearchPanel: Starting search for:', query, 'with filters:', filters);
        
        this.currentQuery = query;
        if (filters) {
            this.currentFilters = filters;
        }

        // Add to recent searches
        this.addToRecentSearches(query);

        this.showSearchLoading();

        try {
            console.log('KnowledgeSearchPanel: Calling search service...');
            this.currentResults = await this.services.performSearch(query, this.currentFilters);
            console.log('KnowledgeSearchPanel: Search results received:', this.currentResults);
            
            this.renderSearchResults();
            
            // Show AI summary if available
            if (this.currentResults.summary && this.currentResults.summary.text) {
                console.log('KnowledgeSearchPanel: Showing AI summary');
                this.showAISummary(this.currentResults.summary.text);
            }
            
            // Show search insights
            console.log('KnowledgeSearchPanel: Showing search insights');
            this.showSearchInsights(this.currentResults);
            
        } catch (error) {
            console.error('KnowledgeSearchPanel: Search failed:', error);
            this.renderSearchError();
        }
    }

    setViewMode(mode: 'list' | 'grid' | 'timeline' | 'domain'): void {
        if (this.currentViewMode === mode) return;
        
        this.currentViewMode = mode;
        this.updateViewModeButtons();
        
        if (this.currentResults && this.currentResults.websites.length > 0) {
            this.renderSearchResults();
        }
    }

    updateFilters(filters: any): void {
        this.currentFilters = { ...this.currentFilters, ...filters };
        if (this.currentQuery) {
            this.performSearch(this.currentQuery);
        }
    }

    destroy(): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    private setupEventListeners(): void {
        // Setup search input with debouncing
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                const query = (event.target as HTMLInputElement).value;
                this.currentQuery = query;
                this.debounceSearch(query);
            });

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch(this.currentQuery.trim());
                }
            });
        }

        // Setup search button
        const searchButton = document.getElementById('searchButton');
        if (searchButton) {
            searchButton.addEventListener('click', () => {
                this.performSearch(this.currentQuery.trim());
            });
        }

        // Setup view mode buttons
        document.querySelectorAll('.view-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const view = target.getAttribute('data-view') as 'list' | 'grid' | 'timeline' | 'domain';
                if (view) {
                    this.setViewMode(view);
                }
            });
        });

        // Setup filter event listeners
        this.setupFilterListeners();
    }

    private setupFilterListeners(): void {
        // Source filter
        const sourceFilter = document.getElementById('sourceFilter') as HTMLSelectElement;
        if (sourceFilter) {
            sourceFilter.addEventListener('change', () => this.updateSearchFilters());
        }

        // Domain filter
        const domainFilter = document.getElementById('domainFilter') as HTMLInputElement;
        if (domainFilter) {
            domainFilter.addEventListener('input', () => this.updateSearchFilters());
        }

        // Date filters
        const dateFrom = document.getElementById('dateFrom') as HTMLInputElement;
        const dateTo = document.getElementById('dateTo') as HTMLInputElement;
        
        if (dateFrom) {
            dateFrom.addEventListener('change', () => this.updateSearchFilters());
        }
        if (dateTo) {
            dateTo.addEventListener('change', () => this.updateSearchFilters());
        }

        // Knowledge filters
        const knowledgeFilters = [
            'hasEntitiesFilter',
            'hasTopicsFilter', 
            'hasActionsFilter',
            'knowledgeExtractedFilter'
        ];

        knowledgeFilters.forEach(filterId => {
            const filter = document.getElementById(filterId) as HTMLInputElement;
            if (filter) {
                filter.addEventListener('change', () => this.updateSearchFilters());
            }
        });
    }

    private updateViewModeButtons(): void {
        document.querySelectorAll('.view-btn').forEach((btn) => {
            btn.classList.remove('active');
        });

        const activeBtn = document.querySelector(`[data-view="${this.currentViewMode}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    private debounceSearch(query: string): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        this.searchDebounceTimer = window.setTimeout(() => {
            if (query.trim()) {
                this.performSearch(query.trim());
            } else {
                this.clearSearchResults();
            }
        }, 300);
    }

    private updateSearchFilters(): void {
        const sourceFilter = document.getElementById('sourceFilter') as HTMLSelectElement;
        const domainFilter = document.getElementById('domainFilter') as HTMLInputElement;
        const dateFrom = document.getElementById('dateFrom') as HTMLInputElement;
        const dateTo = document.getElementById('dateTo') as HTMLInputElement;
        
        const filters: any = {};
        
        if (sourceFilter?.value) {
            filters.sourceType = sourceFilter.value;
        }
        
        if (domainFilter?.value) {
            filters.domain = domainFilter.value;
        }

        if (dateFrom?.value) {
            filters.dateFrom = dateFrom.value;
        }

        if (dateTo?.value) {
            filters.dateTo = dateTo.value;
        }

        // Knowledge filters
        const knowledgeFilters = ['hasEntitiesFilter', 'hasTopicsFilter', 'hasActionsFilter', 'knowledgeExtractedFilter'];
        knowledgeFilters.forEach(filterId => {
            const filter = document.getElementById(filterId) as HTMLInputElement;
            if (filter?.checked) {
                filters[filterId] = true;
            }
        });

        this.updateFilters(filters);
    }

    private showSearchLoading(): void {
        const resultsContainer = document.getElementById('searchResults');
        const emptyState = document.getElementById('searchEmptyState');
        const loadingState = document.getElementById('searchLoadingState');
        const aiSummary = document.getElementById('aiSummary');
        const searchInsightsCard = document.getElementById('searchInsightsCard');

        if (resultsContainer) {
            resultsContainer.style.display = 'block';
        }

        if (emptyState) {
            emptyState.style.display = 'none';
        }

        // Hide AI summary and insights during loading
        if (aiSummary) {
            aiSummary.style.display = 'none';
        }
        if (searchInsightsCard) {
            searchInsightsCard.style.display = 'none';
        }

        if (!loadingState) {
            this.createSearchLoadingState();
        } else {
            loadingState.style.display = 'block';
        }

        const resultsContent = document.getElementById('resultsContainer');
        if (resultsContent) {
            resultsContent.style.display = 'none';
        }
    }

    private createSearchLoadingState(): void {
        const resultsContainer = document.getElementById('searchResults');
        if (!resultsContainer) return;

        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'searchLoadingState';
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = `
            <div class="results-header">
                <h2 class="results-title">Searching...</h2>
            </div>
            <div class="text-center p-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Searching...</span>
                </div>
                <p class="mt-3 mb-0">Searching your library...</p>
            </div>
        `;

        resultsContainer.appendChild(loadingDiv);
    }

    private renderSearchResults(): void {
        const loadingState = document.getElementById('searchLoadingState');
        if (loadingState) {
            loadingState.style.display = 'none';
        }

        const resultsContainer = document.getElementById('searchResults');
        const resultsContent = document.getElementById('resultsContainer');
        
        if (resultsContainer) {
            resultsContainer.style.display = 'block';
        }

        if (resultsContent) {
            resultsContent.style.display = 'block';
        }

        if (!resultsContent || !this.currentResults) return;

        if (this.currentResults.websites.length === 0) {
            resultsContent.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-search"></i>
                    <h6>No Results Found</h6>
                    <p>Try adjusting your search terms or filters.</p>
                </div>
            `;
            return;
        }

        // Add view-specific class to container
        resultsContent.className = 'results-container';
        resultsContent.classList.add(`${this.currentViewMode}-view`);

        let html = '';
        switch (this.currentViewMode) {
            case 'list':
                html = this.renderListView();
                break;
            case 'grid':
                html = this.renderGridView();
                break;
            case 'timeline':
                html = this.renderTimelineView();
                break;
            case 'domain':
                html = this.renderDomainView();
                break;
        }

        resultsContent.innerHTML = `<div class="results-content">${html}</div>`;
    }

    private renderListView(): string {
        if (!this.currentResults) return '';
        return this.currentResults.websites.map((result: Website) => this.renderSearchResultItem(result)).join('');
    }

    private renderGridView(): string {
        if (!this.currentResults) return '';
        
        const gridHtml = this.currentResults.websites
            .map((result: Website) => `
                <div class="card result-card">
                    <div class="card-body">
                        <div class="d-flex align-items-center mb-2">
                            <img src="https://www.google.com/s2/favicons?domain=${result.domain}" 
                                 class="result-favicon me-2" alt="Favicon">
                            <h6 class="card-title mb-0 flex-grow-1">${this.escapeHtml(result.title)}</h6>
                            ${result.score ? `<span class="result-score">${Math.round(result.score * 100)}%</span>` : ''}
                        </div>
                        
                        <div class="result-domain text-muted mb-2">${this.escapeHtml(result.domain)}</div>
                        ${result.snippet ? `<p class="card-text small mb-3">${this.escapeHtml(result.snippet)}</p>` : ''}
                        
                        <div class="knowledge-badges">
                            ${this.renderKnowledgeBadges(result.knowledge)}
                        </div>
                        
                        <a href="${result.url}" target="_blank" class="stretched-link"></a>
                    </div>
                </div>
            `)
            .join('');

        return gridHtml;
    }

    private renderTimelineView(): string {
        if (!this.currentResults) return '';
        
        const grouped = this.currentResults.websites.reduce((acc: Record<string, Website[]>, result: Website) => {
            const date = result.lastVisited
                ? new Date(result.lastVisited).toDateString()
                : 'Unknown Date';
            if (!acc[date]) acc[date] = [];
            acc[date].push(result);
            return acc;
        }, {});

        return Object.entries(grouped)
            .map(([date, results]: [string, Website[]]) => `
                <div class="timeline-item">
                    <div class="timeline-date">${date === 'Unknown Date' ? 'Recently Added' : date}</div>
                    ${results.map((result: Website) => this.renderSearchResultItem(result)).join('')}
                </div>
            `)
            .join('');
    }

    private renderDomainView(): string {
        if (!this.currentResults) return '';
        
        const grouped = this.currentResults.websites.reduce((acc: Record<string, Website[]>, result: Website) => {
            if (!acc[result.domain]) {
                acc[result.domain] = [];
            }
            acc[result.domain].push(result);
            return acc;
        }, {});

        return Object.entries(grouped)
            .map(([domain, results]: [string, Website[]]) => `
                <div class="domain-group">
                    <div class="domain-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div class="d-flex align-items-center">
                                <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                                     class="result-favicon me-2" alt="Favicon">
                                <div>
                                    <strong>${domain}</strong>
                                    <div class="small text-muted">${results.length} pages</div>
                                </div>
                            </div>
                            <div class="d-flex gap-2">
                                <span class="badge">${results.length}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="domain-content">
                        ${results.map((result: Website) => this.renderSearchResultItem(result)).join('')}
                    </div>
                </div>
            `)
            .join('');
    }

    private renderSearchResultItem(result: Website): string {
        return `
            <div class="search-result-item">
                <div class="d-flex align-items-start">
                    <img src="https://www.google.com/s2/favicons?domain=${result.domain}" 
                         class="result-favicon me-2" alt="Favicon">
                    <div class="flex-grow-1">
                        <h6 class="mb-1">
                            <a href="${result.url}" target="_blank" class="text-decoration-none">
                                ${this.escapeHtml(result.title)}
                            </a>
                        </h6>
                        <div class="result-domain text-muted mb-1">${this.escapeHtml(result.domain)}</div>
                        ${result.snippet ? `<p class="mb-2 text-muted small">${this.escapeHtml(result.snippet)}</p>` : ''}
                        
                        <div class="d-flex align-items-center justify-content-between">
                            <div class="knowledge-badges">
                                ${this.renderKnowledgeBadges(result.knowledge)}
                            </div>
                            <div class="d-flex align-items-center gap-2">
                                ${result.knowledge?.confidence ? this.renderConfidenceIndicator(result.knowledge.confidence) : ''}
                                ${result.score ? `<span class="result-score">${Math.round(result.score * 100)}%</span>` : ''}
                                <span class="result-date">${this.formatDate(result.lastVisited)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private renderSearchError(): void {
        const resultsContainer = document.getElementById('searchResults');
        const loadingState = document.getElementById('searchLoadingState');
        
        if (loadingState) {
            loadingState.style.display = 'none';
        }

        if (!resultsContainer) return;

        resultsContainer.style.display = 'block';

        const resultsContent = document.getElementById('resultsContainer');
        if (resultsContent) {
            resultsContent.style.display = 'none';
        }

        let errorContainer = document.getElementById('searchErrorState');
        if (!errorContainer) {
            errorContainer = document.createElement('div');
            errorContainer.id = 'searchErrorState';
            resultsContainer.appendChild(errorContainer);
        }

        errorContainer.style.display = 'block';
        errorContainer.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle me-2"></i>
                Search failed. Please check your connection and try again.
            </div>
        `;
    }

    private clearSearchResults(): void {
        const resultsContainer = document.getElementById('searchResults');
        const emptyState = document.getElementById('searchEmptyState');
        const aiSummary = document.getElementById('aiSummary');
        const searchInsightsCard = document.getElementById('searchInsightsCard');

        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        if (aiSummary) {
            aiSummary.style.display = 'none';
        }
        if (searchInsightsCard) {
            searchInsightsCard.style.display = 'none';
        }

        this.currentResults = null;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setConnectionStatus(isConnected: boolean): void {
        // Update search functionality based on connection status
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        const searchButton = document.getElementById('searchButton') as HTMLButtonElement;
        
        if (searchInput) {
            searchInput.disabled = !isConnected;
            searchInput.placeholder = isConnected 
                ? 'Search websites, bookmarks, and pages using AI...'
                : 'Connection required for search...';
        }
        
        if (searchButton) {
            searchButton.disabled = !isConnected;
        }
        
        // Show connection error if not connected and user tries to search
        if (!isConnected && this.currentQuery) {
            this.showConnectionError();
        }
    }

    performSearchWithQuery(query: string): void {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            this.currentQuery = query;
            this.performSearch(query);
        }
    }

    // Recent searches management
    private loadRecentSearches(): void {
        try {
            const stored = localStorage.getItem('knowledgeLibrary_recentSearches');
            this.recentSearches = stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.warn('Could not load recent searches:', error);
            this.recentSearches = [];
        }
    }

    private saveRecentSearches(): void {
        try {
            localStorage.setItem('knowledgeLibrary_recentSearches', JSON.stringify(this.recentSearches));
        } catch (error) {
            console.warn('Could not save recent searches:', error);
        }
    }

    private addToRecentSearches(query: string): void {
        if (!query.trim()) return;
        
        // Remove if already exists
        const index = this.recentSearches.indexOf(query);
        if (index > -1) {
            this.recentSearches.splice(index, 1);
        }
        
        // Add to beginning
        this.recentSearches.unshift(query);
        
        // Keep only last 10
        this.recentSearches = this.recentSearches.slice(0, 10);
        
        this.saveRecentSearches();
        this.updateRecentSearchesDisplay();
    }

    private updateRecentSearchesDisplay(): void {
        const recentSearchesList = document.getElementById('recentSearchesList');
        if (!recentSearchesList) return;

        if (this.recentSearches.length === 0) {
            recentSearchesList.innerHTML = '<span class="empty-message">No recent searches</span>';
            return;
        }

        const searchTags = this.recentSearches
            .map(search => `
                <span class="recent-search-tag" data-query="${this.escapeHtml(search)}">
                    ${this.escapeHtml(search)}
                </span>
            `)
            .join('');

        recentSearchesList.innerHTML = searchTags;

        // Add click handlers
        recentSearchesList.querySelectorAll('.recent-search-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const query = tag.getAttribute('data-query');
                if (query) {
                    this.performSearchWithQuery(query);
                }
            });
        });
    }

    // SearchInsights functionality
    private showSearchInsights(results: SearchResult): void {
        const insightsCard = document.getElementById('searchInsightsCard');
        let hasInsights = false;

        // Show top topics if available
        if (results.topTopics && results.topTopics.length > 0) {
            this.showTopTopics(results.topTopics);
            hasInsights = true;
        } else {
            this.hideTopTopics();
        }

        // Show suggested followups if available
        if (results.suggestedFollowups && results.suggestedFollowups.length > 0) {
            this.showSuggestedFollowups(results.suggestedFollowups);
            hasInsights = true;
        } else {
            this.hideSuggestedFollowups();
        }

        // Show related entities if available
        if (results.summary.entities && results.summary.entities.length > 0) {
            this.showEntities(results.summary.entities);
            hasInsights = true;
        } else {
            this.hideEntities();
        }

        // Show or hide the entire insights card
        if (insightsCard) {
            insightsCard.style.display = hasInsights ? 'block' : 'none';
        }
    }

    private showAISummary(summary: string): void {
        const summarySection = document.getElementById('aiSummary');
        const summaryContent = document.getElementById('summaryContent');

        if (summarySection && summaryContent) {
            summaryContent.textContent = summary;
            summarySection.style.display = 'block';
        }
    }

    private showTopTopics(topics: string[]): void {
        const topicsSection = document.getElementById('topTopicsSection');
        const topicsContent = document.getElementById('topTopicsContent');

        if (topicsSection && topicsContent && topics.length > 0) {
            const topicTagsHtml = topics
                .map(topic => `
                    <div class="topic-tag" data-topic="${this.escapeHtml(topic)}" title="Search for: ${this.escapeHtml(topic)}">
                        <span>${this.escapeHtml(topic)}</span>
                    </div>
                `)
                .join('');

            topicsContent.innerHTML = `
                <div class="topic-tags">
                    ${topicTagsHtml}
                </div>
            `;

            // Add click handlers
            topicsContent.querySelectorAll('.topic-tag').forEach(tag => {
                tag.addEventListener('click', () => {
                    const topic = tag.getAttribute('data-topic');
                    if (topic) {
                        this.performSearchWithQuery(topic);
                    }
                });
            });

            topicsSection.style.display = 'block';
        } else if (topicsSection) {
            topicsSection.style.display = 'none';
        }
    }

    private showSuggestedFollowups(followups: string[]): void {
        const followupsSection = document.getElementById('suggestedFollowupsSection');
        const followupsContent = document.getElementById('suggestedFollowupsContent');

        if (followupsSection && followupsContent && followups.length > 0) {
            const followupItemsHtml = followups
                .map(followup => `
                    <div class="followup-item" data-followup="${this.escapeHtml(followup)}" title="Search for: ${this.escapeHtml(followup)}">
                        <i class="bi bi-arrow-right"></i>
                        <span>${this.escapeHtml(followup)}</span>
                    </div>
                `)
                .join('');

            followupsContent.innerHTML = `
                <div class="followup-suggestions">
                    ${followupItemsHtml}
                </div>
            `;

            // Add click handlers
            followupsContent.querySelectorAll('.followup-item').forEach(item => {
                item.addEventListener('click', () => {
                    const followup = item.getAttribute('data-followup');
                    if (followup) {
                        this.performSearchWithQuery(followup);
                    }
                });
            });

            followupsSection.style.display = 'block';
        } else if (followupsSection) {
            followupsSection.style.display = 'none';
        }
    }

    private showEntities(entities: EntityMatch[]): void {
        const entitiesSection = document.getElementById('entitiesSection');
        const entitiesContent = document.getElementById('entitiesContent');

        if (entitiesSection && entitiesContent && entities.length > 0) {
            // Sort entities by confidence descending
            const sortedEntities = entities.sort((a, b) => b.confidence - a.confidence);

            const entityTagsHtml = sortedEntities
                .map(entity => `
                    <div class="entity-tag" title="${this.escapeHtml(entity.name)}: confidence ${Math.round(entity.confidence * 100)}%">
                        <span>${this.escapeHtml(entity.name)}</span>
                        <span class="entity-count">${this.escapeHtml(entity.type)}</span>
                    </div>
                `)
                .join('');

            entitiesContent.innerHTML = `
                <div class="entity-tags">
                    ${entityTagsHtml}
                </div>
            `;

            entitiesSection.style.display = 'block';
        } else if (entitiesSection) {
            entitiesSection.style.display = 'none';
        }
    }

    private hideTopTopics(): void {
        const topicsSection = document.getElementById('topTopicsSection');
        if (topicsSection) {
            topicsSection.style.display = 'none';
        }
    }

    private hideSuggestedFollowups(): void {
        const followupsSection = document.getElementById('suggestedFollowupsSection');
        if (followupsSection) {
            followupsSection.style.display = 'none';
        }
    }

    private hideEntities(): void {
        const entitiesSection = document.getElementById('entitiesSection');
        if (entitiesSection) {
            entitiesSection.style.display = 'none';
        }
    }

    // Knowledge badge rendering
    private renderKnowledgeBadges(knowledge: any): string {
        if (!knowledge || knowledge.status === 'none') {
            return '';
        }

        const badges = [];

        if (knowledge.status === 'extracted') {
            if (knowledge.entityCount > 0) {
                badges.push(`
                    <span class="knowledge-badge entities" title="${knowledge.entityCount} entities extracted">
                        <i class="bi bi-diagram-2"></i>
                        ${knowledge.entityCount}
                    </span>
                `);
            }
            if (knowledge.topicCount > 0) {
                badges.push(`
                    <span class="knowledge-badge topics" title="${knowledge.topicCount} topics identified">
                        <i class="bi bi-tags"></i>
                        ${knowledge.topicCount}
                    </span>
                `);
            }
            if (knowledge.suggestionCount > 0) {
                badges.push(`
                    <span class="knowledge-badge actions" title="${knowledge.suggestionCount} actions suggested">
                        <i class="bi bi-lightning"></i>
                        ${knowledge.suggestionCount}
                    </span>
                `);
            }
        } else if (knowledge.status === 'extracting') {
            badges.push(`
                <span class="knowledge-badge extracting" title="Knowledge extraction in progress">
                    <i class="bi bi-arrow-repeat"></i>
                    Extracting...
                </span>
            `);
        } else if (knowledge.status === 'pending') {
            badges.push(`
                <span class="knowledge-badge pending" title="Knowledge extraction pending">
                    <i class="bi bi-clock"></i>
                    Pending
                </span>
            `);
        } else if (knowledge.status === 'error') {
            badges.push(`
                <span class="knowledge-badge error" title="Knowledge extraction failed">
                    <i class="bi bi-exclamation-triangle"></i>
                    Error
                </span>
            `);
        }

        return badges.join('');
    }

    private renderConfidenceIndicator(confidence: number): string {
        const percentage = Math.round(confidence * 100);
        const level = percentage >= 80 ? 'high' : percentage >= 60 ? 'medium' : 'low';
        
        return `
            <span class="confidence-indicator ${level}" title="Confidence: ${percentage}%">
                <i class="bi bi-shield-check"></i>
                ${percentage}%
            </span>
        `;
    }

    private formatDate(dateString?: string): string {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays <= 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    private showConnectionError(): void {
        const resultsContainer = document.getElementById('searchResults');
        const resultsContent = document.getElementById('resultsContainer');
        
        if (resultsContainer) {
            resultsContainer.style.display = 'block';
        }
        
        if (resultsContent) {
            resultsContent.innerHTML = `
                <div class="connection-required">
                    <i class="bi bi-wifi-off"></i>
                    <h3>Connection Required</h3>
                    <p>Search functionality requires an active connection to the TypeAgent service.</p>
                    <button class="btn btn-primary" data-action="reconnect">
                        <i class="bi bi-arrow-repeat"></i> Reconnect
                    </button>
                </div>
            `;
        }
    }
}
