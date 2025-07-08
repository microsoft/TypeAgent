// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
    // Enhanced content data
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics?: {
        readingTime: number;
        wordCount: number;
        hasCode: boolean;
        interactivity: string;
        pageType: string;
    };
}

interface DetectedAction {
    type: string;
    element: string;
    text?: string;
    confidence: number;
}

interface ActionSummary {
    totalActions: number;
    actionTypes: string[];
    highConfidenceActions: number;
    actionDistribution: { [key: string]: number };
}

interface Entity {
    name: string;
    type: string;
    description?: string;
    confidence: number;
}

interface Relationship {
    from: string;
    relationship: string;
    to: string;
    confidence: number;
}

interface ExtractionSettings {
    mode: "basic" | "content" | "actions" | "full";
    enableIntelligentAnalysis: boolean;
    enableActionDetection: boolean;
    suggestQuestions: boolean;
    quality: "fast" | "balanced" | "deep";
}

interface QuestionCategory {
    name: string;
    icon: string;
    color: string;
    questions: CategorizedQuestion[];
    priority: number;
    count: number;
}

interface CategorizedQuestion {
    text: string;
    category: string;
    priority: "high" | "medium" | "low";
    source: "content" | "temporal" | "technical" | "discovery" | "learning";
    confidence: number;
    recommended: boolean;
}

interface PageSourceInfo {
    isBookmarked: boolean;
    isInHistory: boolean;
    visitCount?: number;
    lastVisited?: string;
    bookmarkFolder?: string;
}

interface RelatedContentItem {
    url: string;
    title: string;
    similarity: number;
    relationshipType: "same-domain" | "topic-match" | "code-related";
    excerpt: string;
}

class KnowledgePanel {
    private currentUrl: string = "";
    private isConnected: boolean = false;
    private knowledgeData: KnowledgeData | null = null;
    private pageSourceInfo: PageSourceInfo | null = null;
    private extractionSettings: ExtractionSettings;

    constructor() {
        this.extractionSettings = {
            mode: "full",
            enableIntelligentAnalysis: true,
            enableActionDetection: true,
            suggestQuestions: true,
            quality: "balanced",
        };
    }

    async initialize() {
        console.log("Initializing Enhanced Knowledge Panel");

        this.setupEventListeners();
        await this.loadCurrentPageInfo();
        await this.loadPageSourceInfo();
        await this.loadAutoIndexSetting();
        await this.loadIndexStats();
        await this.checkConnectionStatus();
        await this.loadCachedKnowledge();
        this.setupExtractionModeControls();
        await this.loadExtractionSettings();

        // Setup advanced query controls
        this.setupAdvancedQueryControls();
    }

    private setupEventListeners() {
        document
            .getElementById("extractKnowledge")!
            .addEventListener("click", () => {
                this.extractKnowledge();
            });

        document.getElementById("indexPage")!.addEventListener("click", () => {
            this.indexCurrentPage();
        });

        document
            .getElementById("autoIndexToggle")!
            .addEventListener("change", (e) => {
                const checkbox = e.target as HTMLInputElement;
                this.toggleAutoIndex(checkbox.checked);
            });

        document
            .getElementById("submitQuery")!
            .addEventListener("click", () => {
                this.submitQuery();
            });

        document
            .getElementById("knowledgeQuery")!
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.submitQuery();
                }
            });

        document
            .getElementById("openSettings")!
            .addEventListener("click", () => {
                chrome.runtime.openOptionsPage();
            });

        chrome.tabs.onActivated.addListener(() => {
            this.onTabChange();
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status === "complete") {
                this.onTabChange();
            }
        });
    }

    private async loadCurrentPageInfo() {
        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            if (tabs.length > 0) {
                const tab = tabs[0];
                this.currentUrl = tab.url || "";

                const pageInfo = document.getElementById("currentPageInfo")!;
                const domain = new URL(this.currentUrl).hostname;
                const status = await this.getPageIndexStatus();

                pageInfo.innerHTML = this.createPageInfo(
                    tab.title || "Untitled",
                    domain,
                    status,
                );
            }
        } catch (error) {
            console.error("Error loading page info:", error);
        }
    }

    private async getPageIndexStatus(): Promise<string> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getPageIndexStatus",
                url: this.currentUrl,
            });

            if (response.isIndexed) {
                return '<span class="badge bg-success">Indexed</span>';
            } else {
                return '<span class="badge bg-secondary">Not indexed</span>';
            }
        } catch (error) {
            return '<span class="badge bg-warning">Unknown</span>';
        }
    }

    private async loadAutoIndexSetting() {
        try {
            const settings = await chrome.storage.sync.get(["autoIndexing"]);
            const toggle = document.getElementById(
                "autoIndexToggle",
            ) as HTMLInputElement;
            toggle.checked = settings.autoIndexing || false;
        } catch (error) {
            console.error("Error loading auto-index setting:", error);
        }
    }

    private async toggleAutoIndex(enabled: boolean) {
        try {
            await chrome.storage.sync.set({ autoIndexing: enabled });

            // Update status indicator
            const statusText = enabled
                ? "Auto-indexing enabled"
                : "Auto-indexing disabled";
            this.showTemporaryStatus(statusText, enabled ? "success" : "info");

            // Notify background script
            chrome.runtime.sendMessage({
                type: "autoIndexSettingChanged",
                enabled: enabled,
            });
        } catch (error) {
            console.error("Error toggling auto-index:", error);
        }
    }

    private async extractKnowledge() {
        this.showKnowledgeLoading();

        try {
            const response = await chrome.runtime.sendMessage({
                type: "extractPageKnowledge",
                url: this.currentUrl,
                extractionSettings: this.extractionSettings,
            });

            this.knowledgeData = response.knowledge;
            if (this.knowledgeData) {
                await this.renderKnowledgeResults(this.knowledgeData);
                await this.cacheKnowledge(this.knowledgeData);
                this.showExtractionInfo();
            }

            this.showTemporaryStatus(
                `Knowledge extracted successfully using ${this.extractionSettings.mode} mode!`,
                "success",
            );
        } catch (error) {
            console.error("Error extracting knowledge:", error);
            this.showKnowledgeError(
                "Failed to extract knowledge. Please check your connection.",
            );
        }
    }

    private async indexCurrentPage() {
        const button = document.getElementById(
            "indexPage",
        ) as HTMLButtonElement;
        const originalContent = button.innerHTML;

        button.innerHTML = '<i class="bi bi-hourglass-split"></i> Indexing...';
        button.disabled = true;

        try {
            await chrome.runtime.sendMessage({
                type: "indexPageContentDirect",
                url: this.currentUrl,
            });

            await this.loadCurrentPageInfo();
            await this.loadIndexStats();

            this.showTemporaryStatus("Page indexed successfully!", "success");
        } catch (error) {
            console.error("Error indexing page:", error);
            this.showTemporaryStatus("Failed to index page", "danger");
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }

    private async submitQuery() {
        const queryInput = document.getElementById(
            "knowledgeQuery",
        ) as HTMLInputElement;
        const queryResults = document.getElementById("queryResults")!;
        const query = queryInput.value.trim();

        if (!query) return;

        // Check if advanced filters are enabled
        const advancedControls = document.getElementById(
            "advancedQueryControls",
        );
        const useAdvanced =
            advancedControls && advancedControls.style.display !== "none";

        if (useAdvanced) {
            await this.submitEnhancedQuery(query);
        } else {
            // Use existing basic query logic
            queryResults.innerHTML = this.createSearchLoadingState();

            try {
                const response = await chrome.runtime.sendMessage({
                    type: "queryKnowledge",
                    parameters: {
                        query: query,
                        url: this.currentUrl,
                        searchScope: "current_page",
                    },
                });

                queryResults.innerHTML = this.createQueryAnswer(
                    response.answer,
                    response.sources,
                );
                queryInput.value = "";
            } catch (error) {
                console.error("Error querying knowledge:", error);
                queryResults.innerHTML = this.createAlert(
                    "danger",
                    "bi bi-exclamation-triangle",
                    "Error processing query. Please try again.",
                );
            }
        }
    }

    private showKnowledgeLoading() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = this.createLoadingState(
            "Extracting knowledge from page...",
            "This may take a few seconds",
        );
    }

    private showKnowledgeError(message: string) {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <i class="bi bi-exclamation-triangle text-danger h3"></i>
                    <p class="mb-0">${message}</p>
                </div>
            </div>
        `;
    }

    private async renderKnowledgeResults(knowledge: KnowledgeData) {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            ${knowledge.contentMetrics ? this.renderContentMetricsCard() : ""}
            ${this.renderRelatedContentCard()}
            ${this.renderEntitiesCard()}
            ${this.renderRelationshipsCard()}
            ${this.renderTopicsCard()}
            ${knowledge.detectedActions && knowledge.detectedActions.length > 0 ? this.renderActionsCard() : ""}
        `;

        if (knowledge.contentMetrics) {
            this.renderContentMetrics(knowledge.contentMetrics);
        }
        this.renderRelatedContent(knowledge);
        this.renderEntities(knowledge.entities);
        this.renderRelationships(knowledge.relationships);
        this.renderKeyTopics(knowledge.keyTopics);
        if (knowledge.detectedActions && knowledge.detectedActions.length > 0) {
            this.renderDetectedActions(
                knowledge.detectedActions,
                knowledge.actionSummary,
            );
        }
        this.renderSuggestedQuestions(knowledge.suggestedQuestions);

        // Auto-load cross-page intelligence
        await this.loadRelatedContent(knowledge);

        const questionsSection = document.getElementById("questionsSection")!;
        questionsSection.className = "knowledge-card card";
    }

    private renderEntities(entities: Entity[]) {
        const container = document.getElementById("entitiesContainer")!;
        const countBadge = document.getElementById("entitiesCount")!;

        countBadge.textContent = entities.length.toString();

        if (entities.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No entities found on this page
                </div>
            `;
            return;
        }

        container.innerHTML = entities
            .map(
                (entity) => `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <span class="fw-semibold">${entity.name}</span>
                    <span class="entity-badge badge bg-secondary">${entity.type}</span>
                </div>
                <div>
                    <div class="progress" style="width: 50px; height: 4px;">
                        <div class="progress-bar" style="width: ${entity.confidence * 100}%"></div>
                    </div>
                </div>
            </div>
            ${entity.description ? `<small class="text-muted">${entity.description}</small><hr class="my-2">` : ""}
        `,
            )
            .join("");
    }

    private renderRelationships(relationships: Relationship[]) {
        const container = document.getElementById("relationshipsContainer")!;
        const countBadge = document.getElementById("relationshipsCount")!;

        countBadge.textContent = relationships.length.toString();

        if (relationships.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No relationships identified
                </div>
            `;
            return;
        }

        container.innerHTML = relationships
            .map(
                (rel) => `
            <div class="relationship-item rounded">
                <span class="fw-semibold">${rel.from}</span>
                <i class="bi bi-arrow-right mx-2 text-muted"></i>
                <span class="text-muted">${rel.relationship}</span>
                <i class="bi bi-arrow-right mx-2 text-muted"></i>
                <span class="fw-semibold">${rel.to}</span>
            </div>
        `,
            )
            .join("");
    }

    private renderKeyTopics(topics: string[]) {
        const container = document.getElementById("topicsContainer")!;

        if (topics.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No key topics identified
                </div>
            `;
            return;
        }

        container.innerHTML = topics
            .map(
                (topic) => `
            <span class="badge bg-primary me-1 mb-1">${topic}</span>
        `,
            )
            .join("");
    }

    private renderSuggestedQuestions(questions: string[]) {
        const container = document.getElementById("suggestedQuestions")!;

        if (questions.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No suggested questions available
                </div>
            `;
            return;
        }

        // Use enhanced categorization
        const categories = this.categorizeQuestions(questions);

        let questionsHtml = `
            <div class="mb-3 p-2 bg-light rounded">
                <small class="text-muted d-flex align-items-center">
                    <i class="bi bi-lightbulb me-2"></i> 
                    Smart suggestions based on content analysis
                    <span class="badge bg-primary ms-auto">${questions.length} questions</span>
                </small>
            </div>
        `;

        // Render each category with enhanced styling
        categories.forEach((category) => {
            const highPriorityQuestions = category.questions.filter(
                (q) => q.priority === "high",
            );
            const recommendedCount = category.questions.filter(
                (q) => q.recommended,
            ).length;

            questionsHtml += `
                <div class="question-category-card mb-3" data-category="${category.name.toLowerCase().replace(" ", "-")}">
                    <div class="category-header d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0 text-${category.color}">
                            <i class="${category.icon} me-2"></i>
                            ${category.name}
                            <span class="badge bg-${category.color} ms-2">${category.count}</span>
                            ${recommendedCount > 0 ? `<span class="badge bg-warning ms-1" title="Recommended questions">★ ${recommendedCount}</span>` : ""}
                        </h6>
                        <button class="btn btn-sm btn-outline-${category.color} category-toggle" 
                                data-bs-toggle="collapse" 
                                data-bs-target="#category-${category.name.toLowerCase().replace(" ", "-")}"
                                aria-expanded="true">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="collapse show" id="category-${category.name.toLowerCase().replace(" ", "-")}">
                        ${this.renderEnhancedQuestionList(category.questions, category.color)}
                    </div>
                </div>
            `;
        });

        container.innerHTML = questionsHtml;

        // Add enhanced click handlers
        this.setupQuestionInteractions(container);
    }

    private categorizeQuestions(questions: string[]): QuestionCategory[] {
        const categorizedQuestions: CategorizedQuestion[] = questions.map(
            (question) => {
                return this.categorizeAndScoreQuestion(question);
            },
        );

        // Group questions by category
        const categoryMap = new Map<string, CategorizedQuestion[]>();
        categorizedQuestions.forEach((question) => {
            if (!categoryMap.has(question.category)) {
                categoryMap.set(question.category, []);
            }
            categoryMap.get(question.category)!.push(question);
        });

        // Create category objects with enhanced metadata
        const categories: QuestionCategory[] = [];

        // Add relationship category for enhanced questions
        if (categoryMap.has("relationship")) {
            categories.push({
                name: "Relationships",
                icon: "bi-diagram-3",
                color: "info",
                questions: categoryMap
                    .get("relationship")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 1.5, // High priority, between learning and technical
                count: categoryMap.get("relationship")!.length,
            });
        }

        if (categoryMap.has("learning")) {
            categories.push({
                name: "Learning Path",
                icon: "bi-mortarboard",
                color: "success",
                questions: categoryMap
                    .get("learning")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 1,
                count: categoryMap.get("learning")!.length,
            });
        }

        if (categoryMap.has("technical")) {
            categories.push({
                name: "Technical Deep Dive",
                icon: "bi-code-slash",
                color: "primary",
                questions: categoryMap
                    .get("technical")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 2,
                count: categoryMap.get("technical")!.length,
            });
        }

        if (categoryMap.has("discovery")) {
            categories.push({
                name: "Discovery",
                icon: "bi-compass",
                color: "info",
                questions: categoryMap
                    .get("discovery")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 3,
                count: categoryMap.get("discovery")!.length,
            });
        }

        if (categoryMap.has("content")) {
            categories.push({
                name: "About Content",
                icon: "bi-file-text",
                color: "secondary",
                questions: categoryMap
                    .get("content")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 4,
                count: categoryMap.get("content")!.length,
            });
        }

        if (categoryMap.has("temporal")) {
            categories.push({
                name: "Timeline",
                icon: "bi-clock-history",
                color: "warning",
                questions: categoryMap
                    .get("temporal")!
                    .sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                priority: 5,
                count: categoryMap.get("temporal")!.length,
            });
        }

        // Add any other categories that didn't fit the main ones
        for (const [categoryName, questions] of categoryMap.entries()) {
            if (
                ![
                    "relationship",
                    "learning",
                    "technical",
                    "discovery",
                    "content",
                    "temporal",
                ].includes(categoryName)
            ) {
                categories.push({
                    name:
                        categoryName.charAt(0).toUpperCase() +
                        categoryName.slice(1),
                    icon: "bi-question-circle",
                    color: "light",
                    questions: questions.sort(
                        (a, b) =>
                            this.getQuestionScore(b) - this.getQuestionScore(a),
                    ),
                    priority: 6,
                    count: questions.length,
                });
            }
        }

        return categories.sort((a, b) => a.priority - b.priority);
    }

    // Enhanced question categorization using knowledge context
    private categorizeAndScoreQuestion(question: string): CategorizedQuestion {
        const lowerQ = question.toLowerCase();
        let category = "other";
        let priority: "high" | "medium" | "low" = "medium";
        let confidence = 0.7;
        let recommended = false;

        // Enhanced categorization using knowledge context
        const hasEntities =
            this.knowledgeData?.entities &&
            this.knowledgeData.entities.length > 0;
        const hasRelationships =
            this.knowledgeData?.relationships &&
            this.knowledgeData.relationships.length > 0;
        const hasActions =
            this.knowledgeData?.detectedActions &&
            this.knowledgeData.detectedActions.length > 0;
        const hasTopics =
            this.knowledgeData?.keyTopics &&
            this.knowledgeData.keyTopics.length > 0;

        // Learning-related questions (highest priority for enhanced features)
        if (
            lowerQ.includes("learn") ||
            lowerQ.includes("prerequisite") ||
            lowerQ.includes("should i") ||
            lowerQ.includes("knowledge gap") ||
            lowerQ.includes("next in this area") ||
            lowerQ.includes("learning path") ||
            lowerQ.includes("beginner") ||
            lowerQ.includes("advanced")
        ) {
            category = "learning";
            priority = "high";
            confidence = 0.9;
            recommended = true;

            // Boost confidence if we have rich knowledge context
            if (hasEntities && hasRelationships) confidence = 0.95;
        }
        // Technical questions (enhanced with action detection)
        else if (
            lowerQ.includes("code") ||
            lowerQ.includes("api") ||
            lowerQ.includes("tutorial") ||
            lowerQ.includes("example") ||
            lowerQ.includes("documentation") ||
            lowerQ.includes("implementation") ||
            lowerQ.includes("library") ||
            lowerQ.includes("framework") ||
            lowerQ.includes("how to use") ||
            (hasActions &&
                (lowerQ.includes("interact") ||
                    lowerQ.includes("click") ||
                    lowerQ.includes("action")))
        ) {
            category = "technical";
            priority = "high";
            confidence = 0.85;
            recommended =
                lowerQ.includes("example") ||
                lowerQ.includes("tutorial") ||
                (hasActions ?? false);

            // Boost for pages with detected actions
            if (hasActions) {
                confidence += 0.1;
                recommended = true;
            }
        }
        // Discovery questions (enhanced with entity/topic context)
        else if (
            lowerQ.includes("other") ||
            lowerQ.includes("similar") ||
            lowerQ.includes("else") ||
            lowerQ.includes("show me") ||
            lowerQ.includes("find") ||
            lowerQ.includes("resources") ||
            lowerQ.includes("related") ||
            (hasEntities && lowerQ.includes("more about")) ||
            (hasTopics && lowerQ.includes("explore"))
        ) {
            category = "discovery";
            priority = "medium";
            confidence = 0.8;
            recommended =
                lowerQ.includes("related") ||
                lowerQ.includes("similar") ||
                (hasEntities ?? false);

            // Boost for pages with rich entity/topic context
            if (hasEntities && hasTopics) {
                confidence += 0.15;
                priority = "high";
            }
        }
        // Content-specific questions
        else if (
            lowerQ.includes("what is") ||
            lowerQ.includes("tell me") ||
            lowerQ.includes("summarize") ||
            lowerQ.includes("about") ||
            lowerQ.includes("explain") ||
            lowerQ.includes("key points")
        ) {
            category = "content";
            priority = "medium";
            confidence = 0.75;

            // Boost if we have structured knowledge
            if (hasRelationships) confidence += 0.1;
        }
        // Temporal questions
        else if (
            lowerQ.includes("when") ||
            lowerQ.includes("first") ||
            lowerQ.includes("recently") ||
            lowerQ.includes("journey") ||
            lowerQ.includes("time") ||
            lowerQ.includes("history")
        ) {
            category = "temporal";
            priority = "low";
            confidence = 0.8;
        }
        // Relationship questions (enhanced features specific)
        else if (
            (hasRelationships &&
                (lowerQ.includes("connect") ||
                    lowerQ.includes("relationship") ||
                    lowerQ.includes("between"))) ||
            (hasEntities && lowerQ.includes("how does"))
        ) {
            category = "relationship";
            priority = "high";
            confidence = 0.9;
            recommended = true;
        }

        return {
            text: question,
            category,
            priority,
            source: category as any,
            confidence,
            recommended,
        };
    }

    private getQuestionScore(question: CategorizedQuestion): number {
        let score = question.confidence;

        if (question.recommended) score += 0.3;
        if (question.priority === "high") score += 0.2;
        else if (question.priority === "medium") score += 0.1;

        return score;
    }

    private renderEnhancedQuestionList(
        questions: CategorizedQuestion[],
        color: string,
    ): string {
        return questions
            .map((question, index) => {
                const priorityIcon = this.getPriorityIcon(question.priority);
                const confidenceWidth = Math.round(question.confidence * 100);
                const recommendedBadge = question.recommended
                    ? `<span class="badge bg-warning text-dark ms-2" title="Recommended">★</span>`
                    : "";

                return `
                    <div class="enhanced-question-item list-group-item list-group-item-action p-3 mb-2 rounded border" 
                         data-question="${question.text.replace(/"/g, "&quot;")}" 
                         data-category="${question.category}"
                         data-priority="${question.priority}">
                        <div class="d-flex align-items-start justify-content-between">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <i class="${priorityIcon} me-2 text-${color}"></i>
                                    <span class="fw-semibold">${question.text}</span>
                                    ${recommendedBadge}
                                </div>
                                <div class="d-flex align-items-center">
                                    <small class="text-muted me-3">
                                        <i class="bi bi-tag me-1"></i>${question.category}
                                    </small>
                                    <div class="progress me-2" style="width: 60px; height: 4px;">
                                        <div class="progress-bar bg-${color}" 
                                             style="width: ${confidenceWidth}%" 
                                             title="Relevance: ${confidenceWidth}%">
                                        </div>
                                    </div>
                                    <small class="text-muted">${confidenceWidth}%</small>
                                </div>
                            </div>
                            <i class="bi bi-arrow-right-circle text-${color} ms-2" title="Ask this question"></i>
                        </div>
                    </div>
                `;
            })
            .join("");
    }

    private getPriorityIcon(priority: "high" | "medium" | "low"): string {
        switch (priority) {
            case "high":
                return "bi-star-fill";
            case "medium":
                return "bi-star-half";
            case "low":
                return "bi-star";
            default:
                return "bi-circle";
        }
    }

    private setupQuestionInteractions(container: HTMLElement) {
        // Enhanced question click handling
        container
            .querySelectorAll(".enhanced-question-item")
            .forEach((item) => {
                item.addEventListener("click", () => {
                    const questionText = item.getAttribute("data-question")!;
                    const priority = item.getAttribute("data-priority")!;

                    // Add visual feedback
                    item.classList.add("border-primary", "bg-light");
                    setTimeout(() => {
                        item.classList.remove("border-primary", "bg-light");
                    }, 300);

                    // Set query and submit
                    (
                        document.getElementById(
                            "knowledgeQuery",
                        ) as HTMLInputElement
                    ).value = questionText;
                    this.submitQuery();
                });

                // Add hover effects
                item.addEventListener("mouseenter", () => {
                    item.classList.add("shadow-sm");
                });

                item.addEventListener("mouseleave", () => {
                    item.classList.remove("shadow-sm");
                });
            });

        // Category toggle functionality
        container.querySelectorAll(".category-toggle").forEach((toggle) => {
            toggle.addEventListener("click", (e) => {
                e.preventDefault();
                const icon = toggle.querySelector("i")!;

                // Toggle chevron direction
                if (icon.classList.contains("bi-chevron-down")) {
                    icon.classList.remove("bi-chevron-down");
                    icon.classList.add("bi-chevron-up");
                } else {
                    icon.classList.remove("bi-chevron-up");
                    icon.classList.add("bi-chevron-down");
                }
            });
        });

        // Related content interaction handlers
        this.setupRelatedContentInteractions();
    }

    private setupRelatedContentInteractions() {
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Handle visit page button clicks
            if (target.closest(".visit-page")) {
                e.preventDefault();
                const button = target.closest(".visit-page") as HTMLElement;
                const url = button.getAttribute("data-url");

                if (url) {
                    // Add visual feedback
                    button.classList.add("btn-primary");
                    button.classList.remove("btn-outline-primary");
                    setTimeout(() => {
                        button.classList.remove("btn-primary");
                        button.classList.add("btn-outline-primary");
                    }, 300);

                    // Open the page in a new tab
                    chrome.tabs.create({ url: url, active: false });
                }
            }

            // Handle source open button clicks
            if (target.closest(".source-open-btn")) {
                e.preventDefault();
                const button = target.closest(
                    ".source-open-btn",
                ) as HTMLElement;
                const url = button.getAttribute("data-url");

                if (url) {
                    // Add visual feedback
                    button.classList.add("btn-primary");
                    button.classList.remove("btn-outline-primary");
                    setTimeout(() => {
                        button.classList.remove("btn-primary");
                        button.classList.add("btn-outline-primary");
                    }, 300);

                    // Open the source in a new tab
                    chrome.tabs.create({ url: url, active: false });
                }
            }

            // Handle explore related content button clicks
            if (target.closest(".explore-related")) {
                e.preventDefault();
                const button = target.closest(
                    ".explore-related",
                ) as HTMLElement;
                const query = button.getAttribute("data-query");

                if (query) {
                    // Add visual feedback
                    button.classList.add("btn-secondary");
                    button.classList.remove("btn-outline-secondary");
                    setTimeout(() => {
                        button.classList.remove("btn-secondary");
                        button.classList.add("btn-outline-secondary");
                    }, 300);

                    // Set query and submit
                    const queryInput = document.getElementById(
                        "knowledgeQuery",
                    ) as HTMLInputElement;
                    if (queryInput) {
                        queryInput.value = query;
                        this.submitQuery();
                    }
                }
            }

            // Handle related content item clicks (for future navigation features)
            if (target.closest(".related-page-item")) {
                const item = target.closest(
                    ".related-page-item",
                ) as HTMLElement;
                const url = item.getAttribute("data-url");
                const type = item.getAttribute("data-type");

                // Add visual feedback
                item.classList.add("border-primary", "bg-light");
                setTimeout(() => {
                    item.classList.remove("border-primary", "bg-light");
                }, 300);

                // For now, create a query based on the relationship
                if (url && url === "#") {
                    const title =
                        item.querySelector(".fw-semibold")?.textContent;
                    if (title) {
                        const queryInput = document.getElementById(
                            "knowledgeQuery",
                        ) as HTMLInputElement;
                        if (queryInput) {
                            queryInput.value = `content related to ${title}`;
                        }
                    }
                }
            }
        });
    }

    private async loadIndexStats() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getIndexStats",
            });

            document.getElementById("totalPages")!.textContent =
                response.totalPages.toString();
            document.getElementById("totalEntities")!.textContent =
                response.totalEntities.toString();
            document.getElementById("lastIndexed")!.textContent =
                response.lastIndexed || "Never";
        } catch (error) {
            console.error("Error loading index stats:", error);
        }
    }

    private async loadPageSourceInfo() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getPageSourceInfo",
                url: this.currentUrl,
            });

            this.pageSourceInfo = response.sourceInfo;
            this.updatePageSourceDisplay();
        } catch (error) {
            console.error("Error loading page source info:", error);
        }
    }

    private updatePageSourceDisplay() {
        const pageInfo = document.getElementById("currentPageInfo")!;
        const existingContent = pageInfo.innerHTML;

        if (this.pageSourceInfo) {
            const sourceIndicators = [];

            if (this.pageSourceInfo.isBookmarked) {
                sourceIndicators.push(
                    `<span class="badge bg-primary me-1" title="This page is bookmarked">
                        <i class="bi bi-bookmark-star"></i> Bookmarked
                    </span>`,
                );
            }

            if (this.pageSourceInfo.isInHistory) {
                const visitText = this.pageSourceInfo.visitCount
                    ? this.pageSourceInfo.visitCount + " visits"
                    : "In History";
                sourceIndicators.push(
                    `<span class="badge bg-info me-1" title="This page is in your browser history">
                        <i class="bi bi-clock-history"></i> ${visitText}
                    </span>`,
                );
            }

            if (sourceIndicators.length > 0) {
                const sourceDiv = `<div class="mt-2">${sourceIndicators.join("")}</div>`;
                pageInfo.innerHTML = existingContent + sourceDiv;
            }
        }
    }

    private setupExtractionModeControls() {
        const extractButton = document.getElementById("extractKnowledge")!;
        const buttonGroup = extractButton.parentElement!;

        const modeSelector = document.createElement("div");
        modeSelector.className = "btn-group btn-group-sm ms-2";
        modeSelector.innerHTML = this.createExtractionModeDropdown();

        buttonGroup.appendChild(modeSelector);

        document
            .getElementById("extractionModeMenu")!
            .addEventListener("click", (e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                const item = target.closest(".dropdown-item") as HTMLElement;

                if (item) {
                    const mode = item.getAttribute("data-mode");
                    const option = item.getAttribute("data-option");

                    if (mode) {
                        this.extractionSettings.mode = mode as any;
                        this.updateExtractionModeDisplay();
                        this.saveExtractionSettings();
                    } else if (option === "quality") {
                        this.toggleQualitySetting();
                    }
                }
            });
    }

    private updateExtractionModeDisplay() {
        const button = document.getElementById("extractionModeButton")!;
        button.innerHTML = `<i class="bi bi-gear"></i> ${this.extractionSettings.mode}`;
    }

    private toggleQualitySetting() {
        const qualities = ["fast", "balanced", "deep"];
        const currentIndex = qualities.indexOf(this.extractionSettings.quality);
        const nextIndex = (currentIndex + 1) % qualities.length;
        this.extractionSettings.quality = qualities[nextIndex] as any;

        const qualityItem = document.querySelector('[data-option="quality"]')!;
        qualityItem.innerHTML = `<i class="bi bi-sliders"></i> Quality: ${this.extractionSettings.quality}`;

        this.saveExtractionSettings();
    }

    private async loadExtractionSettings() {
        try {
            const settings = await chrome.storage.sync.get([
                "extractionSettings",
            ]);
            if (settings.extractionSettings) {
                this.extractionSettings = {
                    ...this.extractionSettings,
                    ...settings.extractionSettings,
                };
                this.updateExtractionModeDisplay();
            }
        } catch (error) {
            console.error("Error loading extraction settings:", error);
        }
    }

    private async saveExtractionSettings() {
        try {
            await chrome.storage.sync.set({
                extractionSettings: this.extractionSettings,
            });
        } catch (error) {
            console.error("Error saving extraction settings:", error);
        }
    }

    // Enhanced knowledge extraction status display with advanced integration
    private showExtractionInfo() {
        if (!this.knowledgeData) return;

        const infoDiv = document.createElement("div");
        infoDiv.className = "alert alert-info mt-2";

        // Calculate knowledge quality metrics
        const qualityMetrics = this.calculateKnowledgeQuality(
            this.knowledgeData,
        );

        let content = `<small>
            <i class="bi bi-cpu me-1"></i>
            <strong>Enhanced Extraction</strong> using <strong>${this.extractionSettings.mode}</strong> mode 
            (${this.extractionSettings.quality} quality)
            <div class="mt-2">
                <div class="d-flex align-items-center justify-content-between">
                    <span>Knowledge Quality:</span>
                    <div class="d-flex align-items-center">
                        <div class="progress me-2" style="width: 100px; height: 6px;">
                            <div class="progress-bar bg-${qualityMetrics.color}" 
                                 style="width: ${qualityMetrics.score}%" 
                                 title="Overall quality: ${qualityMetrics.score}%">
                            </div>
                        </div>
                        <span class="badge bg-${qualityMetrics.color}">${qualityMetrics.label}</span>
                    </div>
                </div>
                <div class="row mt-2 g-2">
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.entities.color}">${this.knowledgeData.entities?.length || 0}</div>
                        <small class="text-muted">Entities</small>
                    </div>
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.relationships.color}">${this.knowledgeData.relationships?.length || 0}</div>
                        <small class="text-muted">Relations</small>
                    </div>
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.topics.color}">${this.knowledgeData.keyTopics?.length || 0}</div>
                        <small class="text-muted">Topics</small>
                    </div>
                </div>
            </div>`;

        // Show enhanced capabilities if detected
        if (
            this.knowledgeData.detectedActions &&
            this.knowledgeData.detectedActions.length > 0
        ) {
            content += `
                <div class="mt-2 p-2 bg-light rounded">
                    <small class="text-success">
                        <i class="bi bi-lightning-fill me-1"></i>
                        <strong>Action Detection:</strong> ${this.knowledgeData.detectedActions.length} interactive elements identified
                    </small>
                </div>`;
        }

        if (this.pageSourceInfo?.isBookmarked) {
            content += " • Available in bookmarks";
        }
        if (this.pageSourceInfo?.isInHistory) {
            content += " • Available in history";
        }

        content += "</small>";
        infoDiv.innerHTML = content;

        const knowledgeSection = document.getElementById("knowledgeSection")!;
        const firstCard = knowledgeSection.querySelector(".knowledge-card");
        if (firstCard) {
            knowledgeSection.insertBefore(infoDiv, firstCard);
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkConnection",
            });

            this.isConnected = response.connected;
            this.updateConnectionStatus();
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus")!;
        const indicator = statusElement.querySelector(".status-indicator")!;

        if (this.isConnected) {
            indicator.className = "status-indicator status-connected";
            statusElement.innerHTML = `
                <span class="status-indicator status-connected"></span>
                Connected to TypeAgent
            `;
        } else {
            indicator.className = "status-indicator status-disconnected";
            statusElement.innerHTML = `
                <span class="status-indicator status-disconnected"></span>
                Disconnected from TypeAgent
            `;
        }
    }
    private async onTabChange() {
        await this.loadCurrentPageInfo();
        await this.loadCachedKnowledge();
    }

    private async loadCachedKnowledge() {
        try {
            const knowledgeKey = "knowledge_" + this.currentUrl;
            const cached = await chrome.storage.local.get([knowledgeKey]);

            if (cached[knowledgeKey]) {
                this.knowledgeData = cached[knowledgeKey];
                if (this.knowledgeData) {
                    await this.renderKnowledgeResults(this.knowledgeData);
                }
            } else {
                const knowledgeSection =
                    document.getElementById("knowledgeSection")!;
                knowledgeSection.className = "d-none";

                const questionsSection =
                    document.getElementById("questionsSection")!;
                questionsSection.className = "knowledge-card card d-none";
            }
        } catch (error) {
            console.error("Error loading cached knowledge:", error);
        }
    }

    private async cacheKnowledge(knowledge: KnowledgeData) {
        try {
            const cacheKey = "knowledge_" + this.currentUrl;
            const cacheObject: any = {};
            cacheObject[cacheKey] = knowledge;
            await chrome.storage.local.set(cacheObject);
        } catch (error) {
            console.error("Error caching knowledge:", error);
        }
    }

    private showTemporaryStatus(
        message: string,
        type: "success" | "danger" | "info",
    ) {
        const alertClass = "alert-" + type;
        const iconClass =
            type === "success"
                ? "bi-check-circle"
                : type === "danger"
                  ? "bi-exclamation-triangle"
                  : "bi-info-circle";

        const statusDiv = document.createElement("div");
        statusDiv.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        statusDiv.style.cssText =
            "top: 1rem; right: 1rem; z-index: 1050; min-width: 250px;";
        statusDiv.innerHTML = `
            <i class="${iconClass} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(statusDiv);

        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.remove();
            }
        }, 3000);
    }

    // Template utility functions for knowledge panel
    private createCard(
        title: string,
        content: string,
        icon: string,
        badge?: string,
    ): string {
        const badgeHtml = badge
            ? `<span id="${badge}" class="badge bg-secondary ms-2">0</span>`
            : "";
        return `
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="${icon}"></i> ${title}
                        ${badgeHtml}
                    </h6>
                </div>
                <div class="card-body">
                    ${content}
                </div>
            </div>
        `;
    }

    private createEmptyState(icon: string, message: string): string {
        return `
            <div class="text-muted text-center">
                <i class="${icon}"></i>
                ${message}
            </div>
        `;
    }

    private createContainer(id: string, defaultContent: string): string {
        return `<div id="${id}">${defaultContent}</div>`;
    }

    // Knowledge card component methods
    private renderEntitiesCard(): string {
        const content = this.createContainer(
            "entitiesContainer",
            this.createEmptyState(
                "bi bi-info-circle",
                "No entities extracted yet",
            ),
        );
        return this.createCard(
            "Entities",
            content,
            "bi bi-tags",
            "entitiesCount",
        );
    }

    private renderRelationshipsCard(): string {
        const content = this.createContainer(
            "relationshipsContainer",
            this.createEmptyState(
                "bi bi-info-circle",
                "No relationships found yet",
            ),
        );
        return this.createCard(
            "Relationships",
            content,
            "bi bi-diagram-3",
            "relationshipsCount",
        );
    }

    private renderTopicsCard(): string {
        const content = this.createContainer(
            "topicsContainer",
            this.createEmptyState(
                "bi bi-info-circle",
                "No topics identified yet",
            ),
        );
        return this.createCard("Key Topics", content, "bi bi-bookmark");
    }

    // Alert and loading state utilities
    private createAlert(
        type: "info" | "danger",
        icon: string,
        content: string,
    ): string {
        return `
            <div class="alert alert-${type} mb-0">
                <div class="d-flex align-items-start">
                    <i class="${icon} me-2 mt-1"></i>
                    <div class="flex-grow-1">
                        ${content}
                    </div>
                </div>
            </div>
        `;
    }

    private createLoadingState(message: string, subtext?: string): string {
        const subtextHtml = subtext
            ? `<small class="text-muted">${subtext}</small>`
            : "";
        return `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-3 mb-0">${message}</p>
                    ${subtextHtml}
                </div>
            </div>
        `;
    }

    private createSearchLoadingState(): string {
        return `
            <div class="d-flex align-items-center text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Searching knowledge...</span>
            </div>
        `;
    }

    private createQueryAnswer(answer: string, sources: any[]): string {
        const sourcesHtml =
            sources && sources.length > 0
                ? `
            <hr class="my-2">
            <small class="text-muted">
                <strong>Sources:</strong> ${sources.map((s: any) => s.title).join(", ")}
            </small>
        `
                : "";

        const content = `
            <div class="fw-semibold">Answer:</div>
            <p class="mb-2">${answer}</p>
            ${sourcesHtml}
        `;

        return this.createAlert("info", "bi bi-lightbulb", content);
    }

    // Extraction mode dropdown components
    private createDropdownHeader(text: string): string {
        return `<li><h6 class="dropdown-header">${text}</h6></li>`;
    }

    private createDropdownItem(
        icon: string,
        text: string,
        dataAttr: string,
        value: string,
    ): string {
        return `
            <li><a class="dropdown-item" href="#" ${dataAttr}="${value}">
                <i class="${icon}"></i> ${text}
            </a></li>
        `;
    }

    private createDropdownDivider(): string {
        return `<li><hr class="dropdown-divider"></li>`;
    }

    private createExtractionModeDropdown(): string {
        return `
            <button type="button" class="btn btn-outline-secondary dropdown-toggle" 
                    data-bs-toggle="dropdown" aria-expanded="false" id="extractionModeButton">
                <i class="bi bi-gear"></i> ${this.extractionSettings.mode}
            </button>
            <ul class="dropdown-menu" id="extractionModeMenu">
                ${this.createDropdownHeader("Extraction Mode")}
                ${this.createDropdownItem("bi bi-speedometer", "Basic - Fast extraction", "data-mode", "basic")}
                ${this.createDropdownItem("bi bi-file-text", "Content - Include page analysis", "data-mode", "content")}
                ${this.createDropdownItem("bi bi-lightning", "Actions - Detect actionable elements", "data-mode", "actions")}
                ${this.createDropdownItem("bi bi-cpu", "Full - Complete analysis", "data-mode", "full")}
                ${this.createDropdownDivider()}
                ${this.createDropdownHeader("Options")}
                ${this.createDropdownItem("bi bi-sliders", `Quality: ${this.extractionSettings.quality}`, "data-option", "quality")}
            </ul>
        `;
    }

    private createPageInfo(
        title: string,
        domain: string,
        status: string,
    ): string {
        return `
            <div class="d-flex align-items-center">
                <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                     width="16" height="16" class="me-2" alt="favicon">
                <div class="flex-grow-1">
                    <div class="fw-semibold">${title || "Untitled"}</div>
                    <small class="text-muted">${domain}</small>
                </div>
                <div id="pageStatus" class="ms-2">${status}</div>
            </div>
        `;
    }

    // Content Metrics Card component with enhanced visualization
    private renderContentMetricsCard(): string {
        const content = this.createContainer(
            "contentMetricsContainer",
            this.createEmptyState(
                "bi bi-info-circle",
                "No content metrics available",
            ),
        );
        return this.createCard(
            "Content Analysis",
            content,
            "bi bi-bar-chart-line",
        );
    }

    // Related Content Card component
    private renderRelatedContentCard(): string {
        const content = this.createContainer(
            "relatedContentContainer",
            this.createEmptyState(
                "bi bi-info-circle",
                "No related content found",
            ),
        );
        return this.createCard(
            "Related Content",
            content,
            "bi bi-link-45deg",
            "relatedContentCount",
        );
    }
    private renderActionsCard(): string {
        const content = this.createContainer(
            "detectedActionsContainer",
            this.createEmptyState("bi bi-info-circle", "No actions detected"),
        );
        return this.createCard(
            "Detected Actions",
            content,
            "bi bi-lightning",
            "actionsCount",
        );
    }

    // Render enhanced content metrics with visual indicators
    private renderContentMetrics(metrics: any) {
        const container = document.getElementById("contentMetricsContainer")!;

        // Calculate derived metrics
        const readingTimeCategory = this.getReadingTimeCategory(
            metrics.readingTime,
        );
        const wordCountCategory = this.getWordCountCategory(metrics.wordCount);
        const pageTypeInfo = this.getPageTypeInfo(metrics.pageType);
        const codeIntensity = this.getCodeIntensity(
            metrics.hasCode,
            metrics.wordCount,
        );

        container.innerHTML = `
            <!-- Reading Time Section -->
            <div class="metric-section mb-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-primary">
                        <i class="bi bi-clock me-2"></i>Reading Time
                    </h6>
                    <span class="badge bg-${readingTimeCategory.color}">${readingTimeCategory.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="d-flex align-items-center mb-2">
                        <div class="reading-time-display me-3">
                            <span class="h4 mb-0 text-primary">${metrics.readingTime}</span>
                            <small class="text-muted ms-1">min</small>
                        </div>
                        <div class="flex-grow-1">
                            <div class="progress" style="height: 8px;">
                                <div class="progress-bar bg-${readingTimeCategory.color}" 
                                     style="width: ${Math.min(metrics.readingTime * 10, 100)}%"
                                     title="${metrics.readingTime} minutes">
                                </div>
                            </div>
                            <small class="text-muted">${readingTimeCategory.description}</small>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Word Count Section -->
            <div class="metric-section mb-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-info">
                        <i class="bi bi-file-text me-2"></i>Content Volume
                    </h6>
                    <span class="badge bg-${wordCountCategory.color}">${wordCountCategory.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="row text-center mb-2">
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-info">${metrics.wordCount.toLocaleString()}</div>
                                <small class="text-muted">Words</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-info">${Math.round(metrics.wordCount / Math.max(metrics.readingTime, 1))}</div>
                                <small class="text-muted">WPM</small>
                            </div>
                        </div>
                    </div>
                    <small class="text-muted">${wordCountCategory.description}</small>
                </div>
            </div>

            <!-- Page Type Section -->
            <div class="metric-section mb-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-success">
                        <i class="${pageTypeInfo.icon} me-2"></i>Page Type
                    </h6>
                    <span class="badge bg-${pageTypeInfo.color}">${pageTypeInfo.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="page-type-indicator p-3 bg-light rounded">
                        <div class="d-flex align-items-center">
                            <i class="${pageTypeInfo.icon} text-${pageTypeInfo.color} me-3" style="font-size: 1.5rem;"></i>
                            <div>
                                <div class="fw-semibold">${metrics.pageType}</div>
                                <small class="text-muted">${pageTypeInfo.description}</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Technical Content Section -->
            <div class="metric-section">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-warning">
                        <i class="bi bi-code-slash me-2"></i>Technical Content
                    </h6>
                    <span class="badge bg-${codeIntensity.color}">${codeIntensity.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="row text-center">
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-${metrics.hasCode ? "success" : "muted"}">
                                    <i class="bi bi-${metrics.hasCode ? "check-circle-fill" : "x-circle"}"></i>
                                </div>
                                <small class="text-muted">Code Present</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-secondary">
                                    ${metrics.interactivity !== "static" ? '<i class="bi bi-lightning-fill"></i>' : '<i class="bi bi-file-text"></i>'}
                                </div>
                                <small class="text-muted">${this.getInteractivityLevel(metrics.interactivity)}</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Render detected actions
    private renderDetectedActions(
        actions: DetectedAction[],
        summary?: ActionSummary,
    ) {
        const container = document.getElementById("detectedActionsContainer")!;
        const countBadge = document.getElementById("actionsCount");

        if (countBadge) {
            countBadge.textContent = actions.length.toString();
        }

        if (actions.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No actions detected on this page
                </div>
            `;
            return;
        }

        let summaryHtml = "";
        if (summary) {
            summaryHtml = `
                <div class="mb-3 p-2 bg-light rounded">
                    <small class="text-muted">Summary:</small><br>
                    <span class="fw-semibold">${summary.totalActions} total actions</span>
                    ${summary.actionTypes.length > 0 ? `<br><small>Types: ${summary.actionTypes.join(", ")}</small>` : ""}
                </div>
            `;
        }

        const actionsHtml = actions
            .slice(0, 10)
            .map(
                (action) => `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 border rounded">
                    <div>
                        <span class="fw-semibold">${action.type}</span>
                        <span class="badge bg-secondary ms-2">${action.element}</span>
                        ${action.text ? `<br><small class="text-muted">${action.text}</small>` : ""}
                    </div>
                    <div>
                        <div class="progress" style="width: 50px; height: 4px;">
                            <div class="progress-bar bg-success" style="width: ${action.confidence * 100}%"></div>
                        </div>
                    </div>
                </div>
            `,
            )
            .join("");

        container.innerHTML = summaryHtml + actionsHtml;
    }

    // Helper methods for enhanced content metrics
    private getReadingTimeCategory(readingTime: number) {
        if (readingTime <= 2) {
            return {
                color: "success",
                label: "Quick Read",
                description: "Fast consumption content",
            };
        } else if (readingTime <= 5) {
            return {
                color: "info",
                label: "Short Read",
                description: "Brief but informative",
            };
        } else if (readingTime <= 15) {
            return {
                color: "warning",
                label: "Medium Read",
                description: "Substantial content",
            };
        } else {
            return {
                color: "danger",
                label: "Long Read",
                description: "In-depth material",
            };
        }
    }

    private getWordCountCategory(wordCount: number) {
        if (wordCount <= 300) {
            return {
                color: "success",
                label: "Brief",
                description: "Concise and focused content",
            };
        } else if (wordCount <= 1000) {
            return {
                color: "info",
                label: "Standard",
                description: "Typical article length",
            };
        } else if (wordCount <= 3000) {
            return {
                color: "warning",
                label: "Detailed",
                description: "Comprehensive coverage",
            };
        } else {
            return {
                color: "danger",
                label: "Extensive",
                description: "In-depth exploration",
            };
        }
    }

    private getPageTypeInfo(pageType: string) {
        const typeMap: {
            [key: string]: {
                icon: string;
                color: string;
                label: string;
                description: string;
            };
        } = {
            tutorial: {
                icon: "bi-book",
                color: "primary",
                label: "Tutorial",
                description: "Step-by-step learning content",
            },
            documentation: {
                icon: "bi-file-earmark-text",
                color: "info",
                label: "Documentation",
                description: "Reference material",
            },
            blog: {
                icon: "bi-journal-text",
                color: "success",
                label: "Blog Post",
                description: "Opinion and insights",
            },
            news: {
                icon: "bi-newspaper",
                color: "warning",
                label: "News",
                description: "Current events",
            },
            product: {
                icon: "bi-box",
                color: "danger",
                label: "Product",
                description: "Commercial content",
            },
            forum: {
                icon: "bi-chat-dots",
                color: "secondary",
                label: "Discussion",
                description: "Community content",
            },
            other: {
                icon: "bi-file-text",
                color: "light",
                label: "General",
                description: "Mixed content type",
            },
        };

        return typeMap[pageType] || typeMap["other"];
    }

    private getCodeIntensity(hasCode: boolean, wordCount: number) {
        if (!hasCode) {
            return {
                color: "light",
                label: "Non-Technical",
                percentage: 0,
                description: "No code content detected",
            };
        }

        // Estimate technical intensity based on word count and code presence
        const intensity = Math.min(
            Math.round((1000 / Math.max(wordCount, 100)) * 100),
            100,
        );

        if (intensity >= 50) {
            return {
                color: "danger",
                label: "Code-Heavy",
                percentage: intensity,
                description: "Significant programming content",
            };
        } else if (intensity >= 25) {
            return {
                color: "warning",
                label: "Technical",
                percentage: intensity,
                description: "Mixed technical content",
            };
        } else {
            return {
                color: "info",
                label: "Light Code",
                percentage: intensity,
                description: "Some code examples",
            };
        }
    }

    private getInteractivityLevel(interactivity: string): string {
        if (interactivity === "static" || !interactivity) return "Static";
        if (interactivity.includes("form")) return "Interactive";
        if (interactivity.includes("button")) return "Clickable";
        return "Dynamic";
    }

    private getInteractivityIcon(interactivity: string): string {
        if (interactivity === "static" || !interactivity) return "file-text";
        if (interactivity.includes("form")) return "ui-checks";
        if (interactivity.includes("button")) return "hand-index";
        return "cursor";
    }

    // Render related content discovery using enhanced search methods
    private async renderRelatedContent(knowledge: KnowledgeData) {
        const container = document.getElementById("relatedContentContainer")!;
        const countBadge = document.getElementById("relatedContentCount");

        // Show loading state
        container.innerHTML = `
            <div class="text-center p-3">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                <small class="text-muted">Discovering relationships using enhanced search...</small>
            </div>
        `;

        try {
            // Use enhanced search methods for relationship discovery
            const relatedContent: RelatedContentItem[] = [];

            // 1. Entity-based relationship discovery
            if (knowledge.entities && knowledge.entities.length > 0) {
                const entityResults = await this.discoverEntityRelationships(
                    knowledge.entities,
                );
                relatedContent.push(...entityResults);
            }

            // 2. Topic-based relationship discovery
            if (knowledge.keyTopics && knowledge.keyTopics.length > 0) {
                const topicResults = await this.discoverTopicRelationships(
                    knowledge.keyTopics,
                );
                relatedContent.push(...topicResults);
            }

            // 3. Hybrid search for content similarity
            const hybridResults = await this.discoverHybridRelationships(
                knowledge.summary,
            );
            relatedContent.push(...hybridResults);

            // Update count badge
            if (countBadge) {
                countBadge.textContent = relatedContent.length.toString();
            }

            if (relatedContent.length > 0) {
                container.innerHTML = `
                    <div class="related-content-summary mb-3 p-2 bg-light rounded">
                        <small class="text-muted">
                            <i class="bi bi-cpu me-1"></i>
                            Found ${relatedContent.length} connections using enhanced search methods
                        </small>
                    </div>
                    ${this.renderRelatedContentSections(relatedContent)}
                `;
                this.setupRelatedContentInteractions();
            } else {
                container.innerHTML = `
                    <div class="text-muted text-center">
                        <i class="bi bi-info-circle"></i>
                        No related content discovered yet. Index more pages to see connections.
                    </div>
                `;
            }
        } catch (error) {
            console.warn("Enhanced relationship discovery failed:", error);
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-exclamation-triangle"></i>
                    Unable to discover relationships using enhanced search
                </div>
            `;
        }
    }

    // Fallback method for basic related content
    private renderFallbackRelatedContent(
        knowledge: KnowledgeData,
        container: HTMLElement,
        countBadge: HTMLElement | null,
    ) {
        const relatedContent = this.generateRelatedContent(knowledge);

        if (countBadge) {
            countBadge.textContent = relatedContent.length.toString();
        }

        if (relatedContent.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No related content discovered yet. Extract knowledge from more pages to see connections.
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="related-content-summary mb-3 p-2 bg-light rounded">
                <small class="text-muted">
                    <i class="bi bi-graph-up me-1"></i>
                    Found ${relatedContent.length} potential connections based on content analysis
                </small>
            </div>
            ${this.renderRelatedContentSections(relatedContent)}
        `;
    }

    private generateRelatedContent(
        knowledge: KnowledgeData,
    ): RelatedContentItem[] {
        const relatedContent: RelatedContentItem[] = [];
        const currentDomain = this.extractDomainFromUrl(this.currentUrl);

        // Generate same-domain suggestions
        if (currentDomain) {
            relatedContent.push({
                url: `https://${currentDomain}`,
                title: `Other pages from ${currentDomain}`,
                similarity: 0.8,
                relationshipType: "same-domain",
                excerpt: `Explore more content from this website domain`,
            });
        }

        // Generate topic-based suggestions from knowledge
        if (knowledge.keyTopics && knowledge.keyTopics.length > 0) {
            knowledge.keyTopics.slice(0, 3).forEach((topic) => {
                relatedContent.push({
                    url: "#",
                    title: `More content about "${topic}"`,
                    similarity: 0.7,
                    relationshipType: "topic-match",
                    excerpt: `Find other pages that discuss ${topic} in your knowledge base`,
                });
            });
        }

        // Generate code-related suggestions if code is detected
        if (knowledge.contentMetrics?.hasCode) {
            relatedContent.push({
                url: "#",
                title: "Similar programming content",
                similarity: 0.6,
                relationshipType: "code-related",
                excerpt: "Other pages with code examples and technical content",
            });
        }

        // Generate entity-based suggestions
        if (knowledge.entities && knowledge.entities.length > 0) {
            const topEntity = knowledge.entities[0];
            relatedContent.push({
                url: "#",
                title: `More about "${topEntity.name}"`,
                similarity: 0.65,
                relationshipType: "topic-match",
                excerpt: `Find additional information about ${topEntity.name} in your saved content`,
            });
        }

        return relatedContent.slice(0, 6); // Limit to 6 suggestions
    }

    private renderRelatedContentSections(
        relatedContent: RelatedContentItem[],
    ): string {
        // Group by relationship type
        const grouped = relatedContent.reduce(
            (acc, item) => {
                if (!acc[item.relationshipType]) {
                    acc[item.relationshipType] = [];
                }
                acc[item.relationshipType].push(item);
                return acc;
            },
            {} as { [key: string]: RelatedContentItem[] },
        );

        let html = "";

        Object.entries(grouped).forEach(([type, items]) => {
            const typeInfo = this.getRelationshipTypeInfo(type);

            html += `
                <div class="related-section mb-3">
                    <h6 class="text-${typeInfo.color} mb-2">
                        <i class="${typeInfo.icon} me-2"></i>${typeInfo.label}
                        <span class="badge bg-${typeInfo.color} ms-2">${items.length}</span>
                    </h6>
                    <div class="related-items">
                        ${items.map((item) => this.renderRelatedContentItem(item, typeInfo.color)).join("")}
                    </div>
                </div>
            `;
        });

        return html;
    }

    private renderRelatedContentItem(
        item: RelatedContentItem,
        color: string,
    ): string {
        const similarityWidth = Math.round(item.similarity * 100);

        return `
            <div class="related-content-item p-2 mb-2 border rounded bg-white" 
                 data-url="${item.url}" data-type="${item.relationshipType}">
                <div class="d-flex align-items-start justify-content-between">
                    <div class="flex-grow-1">
                        <div class="fw-semibold mb-1">${item.title}</div>
                        <small class="text-muted mb-2 d-block">${item.excerpt}</small>
                        <div class="d-flex align-items-center">
                            <small class="text-muted me-2">Relevance:</small>
                            <div class="progress me-2" style="width: 80px; height: 4px;">
                                <div class="progress-bar bg-${color}" 
                                     style="width: ${similarityWidth}%" 
                                     title="Relevance: ${similarityWidth}%">
                                </div>
                            </div>
                            <small class="text-muted">${similarityWidth}%</small>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-${color} explore-related" 
                            data-query="${item.title}" title="Explore this connection">
                        <i class="bi bi-arrow-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    private getRelationshipTypeInfo(type: string) {
        const typeMap: {
            [key: string]: { icon: string; color: string; label: string };
        } = {
            "same-domain": {
                icon: "bi-globe",
                color: "primary",
                label: "Same Website",
            },
            "topic-match": {
                icon: "bi-tags",
                color: "success",
                label: "Related Topics",
            },
            "code-related": {
                icon: "bi-code-slash",
                color: "warning",
                label: "Code Content",
            },
        };

        return (
            typeMap[type] || {
                icon: "bi-link",
                color: "secondary",
                label: "Related",
            }
        );
    }

    // Enhanced relationship rendering using relationship discovery data
    private renderEnhancedRelatedContentSections(
        relationshipResults: any[],
    ): string {
        let html = "";

        relationshipResults.forEach((result) => {
            if (result.relatedPages.length > 0) {
                const typeInfo = this.getAnalysisTypeInfo(result.analysisType);

                html += `
                    <div class="related-section mb-3">
                        <h6 class="text-${typeInfo.color} mb-2">
                            <i class="${typeInfo.icon} me-2"></i>${typeInfo.label}
                            <span class="badge bg-${typeInfo.color} ms-2">${result.relatedPages.length}</span>
                            <span class="badge bg-light text-dark ms-1" title="Confidence">
                                ${Math.round(result.confidence * 100)}%
                            </span>
                        </h6>
                        <div class="related-items">
                            ${result.relatedPages
                                .slice(0, 5)
                                .map((page: any) =>
                                    this.renderRelatedPageItem(
                                        page,
                                        typeInfo.color,
                                    ),
                                )
                                .join("")}
                        </div>
                    </div>
                `;
            }
        });

        return html;
    }

    private renderRelatedPageItem(page: any, color: string): string {
        const similarityWidth = Math.round(page.similarity * 100);
        const visitInfo = page.visitInfo || {};

        return `
            <div class="related-item p-3 mb-2 border rounded bg-white" 
                 data-url="${page.url}" 
                 data-type="${page.relationshipType}">
                <div class="d-flex align-items-start justify-content-between">
                    <div class="flex-grow-1">
                        <div class="fw-semibold mb-1">${page.title}</div>
                        <div class="mb-2">
                            <span class="badge bg-${color} me-1">${page.relationshipType}</span>
                            ${
                                page.sharedElements &&
                                page.sharedElements.length > 0
                                    ? `<small class="text-muted">Shared: ${page.sharedElements.slice(0, 2).join(", ")}</small>`
                                    : ""
                            }
                        </div>
                        <div class="d-flex align-items-center mb-2">
                            <small class="text-muted me-2">Similarity:</small>
                            <div class="progress me-2" style="width: 80px; height: 4px;">
                                <div class="progress-bar bg-${color}" 
                                     style="width: ${similarityWidth}%" 
                                     title="Similarity: ${similarityWidth}%">
                                </div>
                            </div>
                            <small class="text-muted">${similarityWidth}%</small>
                        </div>
                        ${
                            visitInfo.visitCount
                                ? `
                            <small class="text-muted">
                                <i class="bi bi-clock me-1"></i>
                                Visited ${visitInfo.visitCount} time${visitInfo.visitCount > 1 ? "s" : ""}
                                ${visitInfo.lastVisited ? ` • Last: ${this.formatDate(visitInfo.lastVisited)}` : ""}
                            </small>
                        `
                                : ""
                        }
                    </div>
                    <button class="btn btn-sm btn-outline-${color} explore-page" 
                            data-url="${page.url}" 
                            title="Open this page">
                        <i class="bi bi-arrow-up-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    private getAnalysisTypeInfo(type: string) {
        const typeMap: {
            [key: string]: { icon: string; color: string; label: string };
        } = {
            domain: {
                icon: "bi-globe",
                color: "primary",
                label: "Same Website",
            },
            topic: {
                icon: "bi-tags",
                color: "success",
                label: "Similar Topics",
            },
            entity: {
                icon: "bi-diagram-2",
                color: "info",
                label: "Shared Entities",
            },
            technical: {
                icon: "bi-code-slash",
                color: "warning",
                label: "Technical Content",
            },
            temporal: {
                icon: "bi-clock-history",
                color: "secondary",
                label: "Recent Activity",
            },
        };

        return (
            typeMap[type] || {
                icon: "bi-link",
                color: "secondary",
                label: "Related",
            }
        );
    }

    private setupEnhancedRelatedContentInteractions() {
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Handle explore page button clicks
            if (target.closest(".explore-page")) {
                e.preventDefault();
                const button = target.closest(".explore-page") as HTMLElement;
                const url = button.getAttribute("data-url");

                if (url) {
                    // Open the page in a new tab
                    chrome.tabs.create({ url });
                }
            }

            // Handle related item clicks for analysis
            if (target.closest(".related-item")) {
                const item = target.closest(".related-item") as HTMLElement;
                const url = item.getAttribute("data-url");
                const type = item.getAttribute("data-type");

                // Add visual feedback
                item.classList.add("border-primary", "bg-light");
                setTimeout(() => {
                    item.classList.remove("border-primary", "bg-light");
                }, 300);

                // Could trigger additional analysis or actions
                console.log(`Analyzing relationship: ${type} to ${url}`);
            }
        });
    }

    // Load related content using relationship discovery
    private async loadRelatedContent(knowledge: KnowledgeData) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "discoverRelationships",
                url: this.currentUrl,
                knowledge: knowledge,
                maxResults: 10,
            });

            if (response.success && response.relationships.length > 0) {
                this.renderRelatedContent(response.relationships);
            }

            // Also load temporal suggestions
            await this.loadTemporalSuggestions();
        } catch (error) {
            console.warn("Relationship discovery failed:", error);
        }
    }

    private async loadTemporalSuggestions() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "generateTemporalSuggestions",
                maxSuggestions: 6,
            });

            if (response.success && response.suggestions.length > 0) {
                this.addTemporalSuggestions(
                    response.suggestions,
                    response.contextInfo,
                );
            }
        } catch (error) {
            console.warn("Error loading temporal suggestions:", error);
        }
    }

    private addTemporalSuggestions(suggestions: string[], contextInfo: any) {
        // Add temporal suggestions to the existing categorized questions
        const questionsContainer =
            document.getElementById("suggestedQuestions");
        if (!questionsContainer) return;

        // Find or create temporal category
        let temporalCategory =
            questionsContainer.querySelector("#category-temporal");

        if (!temporalCategory) {
            // Create new temporal category
            const temporalCategoryHtml = `
                <div class="question-category-card mb-3" data-category="temporal">
                    <div class="category-header d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0 text-warning">
                            <i class="bi bi-clock-history me-2"></i>
                            Timeline & History
                            <span class="badge bg-warning ms-2">${suggestions.length}</span>
                            <span class="badge bg-info ms-1" title="Recent activity">
                                📊 ${contextInfo.uniqueDomains} domains, ${contextInfo.uniqueTopics} topics
                            </span>
                        </h6>
                        <button class="btn btn-sm btn-outline-warning category-toggle" 
                                data-bs-toggle="collapse" 
                                data-bs-target="#category-temporal"
                                aria-expanded="true">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="collapse show" id="category-temporal">
                        ${this.renderTemporalQuestionList(suggestions)}
                    </div>
                </div>
            `;

            // Insert after existing categories
            questionsContainer.insertAdjacentHTML(
                "beforeend",
                temporalCategoryHtml,
            );

            // Setup interaction handlers for new questions
            this.setupQuestionInteractions(questionsContainer);
        }
    }

    private renderTemporalQuestionList(suggestions: string[]): string {
        return suggestions
            .map((question, index) => {
                const isRecommended = index < 2; // First 2 are recommended
                const recommendedBadge = isRecommended
                    ? `<span class="badge bg-warning text-dark ms-2" title="Recommended">★</span>`
                    : "";

                return `
                    <div class="enhanced-question-item list-group-item list-group-item-action p-3 mb-2 rounded border" 
                         data-question="${question.replace(/"/g, "&quot;")}" 
                         data-category="temporal"
                         data-priority="${isRecommended ? "high" : "medium"}">
                        <div class="d-flex align-items-start justify-content-between">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <i class="bi bi-clock-history me-2 text-warning"></i>
                                    <span class="fw-semibold">${question}</span>
                                    ${recommendedBadge}
                                </div>
                                <div class="d-flex align-items-center">
                                    <small class="text-muted me-3">
                                        <i class="bi bi-tag me-1"></i>temporal
                                    </small>
                                    <div class="progress me-2" style="width: 60px; height: 4px;">
                                        <div class="progress-bar bg-warning" 
                                             style="width: ${isRecommended ? 85 : 70}%" 
                                             title="Relevance: ${isRecommended ? 85 : 70}%">
                                        </div>
                                    </div>
                                    <small class="text-muted">${isRecommended ? 85 : 70}%</small>
                                </div>
                            </div>
                            <i class="bi bi-arrow-right-circle text-warning ms-2" title="Ask this question"></i>
                        </div>
                    </div>
                `;
            })
            .join("");
    }

    private renderRelationshipResults(relationships: any[]) {
        const container = document.getElementById("relatedContentContainer")!;
        const countBadge = document.getElementById("relatedContentCount");

        if (countBadge) {
            countBadge.textContent = relationships
                .reduce((sum, rel) => sum + rel.relatedPages.length, 0)
                .toString();
        }

        if (relationships.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No related content found
                </div>
            `;
            return;
        }

        // Group relationships by type for better organization
        const groupedRelationships =
            this.groupRelationshipsByType(relationships);

        container.innerHTML = Object.entries(groupedRelationships)
            .map(
                ([type, typeRelationships]) => `
                <div class="relationship-type-group mb-3">
                    <h6 class="text-${this.getRelationshipTypeColor(type)} mb-2">
                        <i class="${this.getRelationshipTypeIcon(type)} me-2"></i>
                        ${this.getRelationshipTypeLabel(type)}
                        <span class="badge bg-${this.getRelationshipTypeColor(type)} ms-2">
                            ${typeRelationships.reduce((sum: number, rel: any) => sum + rel.relatedPages.length, 0)}
                        </span>
                    </h6>
                    ${typeRelationships
                        .map((relationship) =>
                            relationship.relatedPages
                                .slice(0, 3)
                                .map(
                                    (page: any) => `
                            <div class="related-content-item p-2 mb-2 border rounded border-${this.getRelationshipTypeColor(type)} related-page-item" 
                                 data-url="${page.url}" 
                                 data-type="${page.relationshipType}"
                                 style="cursor: pointer;">
                                <div class="d-flex align-items-start justify-content-between">
                                    <div class="flex-grow-1">
                                        <div class="fw-semibold mb-1">${page.title}</div>
                                        <small class="text-muted mb-1 d-block">
                                            ${page.sharedElements.join(", ")}
                                        </small>
                                        <div class="d-flex align-items-center">
                                            <span class="badge bg-${this.getRelationshipTypeColor(type)} me-2">
                                                ${Math.round(page.similarity * 100)}% similar
                                            </span>
                                            <small class="text-muted">
                                                <i class="bi bi-clock me-1"></i>
                                                Last visited: ${this.formatDate(page.visitInfo.lastVisited)}
                                            </small>
                                        </div>
                                    </div>
                                    <div class="d-flex flex-column">
                                        <button class="btn btn-sm btn-outline-primary mb-1 visit-page" 
                                                data-url="${page.url}" 
                                                title="Visit this page">
                                            <i class="bi bi-box-arrow-up-right"></i>
                                        </button>
                                        <button class="btn btn-sm btn-outline-secondary explore-related" 
                                                data-query="similar to ${page.title}" 
                                                title="Find similar content">
                                            <i class="bi bi-search"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `,
                                )
                                .join(""),
                        )
                        .join("")}
                </div>
            `,
            )
            .join("");

        // Add interaction handlers
        this.setupRelatedContentInteractions();
    }

    private groupRelationshipsByType(relationships: any[]): {
        [key: string]: any[];
    } {
        const grouped: { [key: string]: any[] } = {};

        for (const relationship of relationships) {
            const type = relationship.analysisType || "other";
            if (!grouped[type]) {
                grouped[type] = [];
            }
            grouped[type].push(relationship);
        }

        return grouped;
    }

    private getRelationshipTypeColor(type: string): string {
        const colors = {
            domain: "primary",
            topic: "success",
            entity: "info",
            technical: "warning",
            temporal: "secondary",
        };
        return colors[type as keyof typeof colors] || "secondary";
    }

    private getRelationshipTypeIcon(type: string): string {
        const icons = {
            domain: "bi-globe",
            topic: "bi-tags",
            entity: "bi-diagram-3",
            technical: "bi-code-slash",
            temporal: "bi-clock-history",
        };
        return icons[type as keyof typeof icons] || "bi-link";
    }

    private getRelationshipTypeLabel(type: string): string {
        const labels = {
            domain: "Same Domain",
            topic: "Similar Topics",
            entity: "Shared Entities",
            technical: "Technical Content",
            temporal: "Recently Visited",
        };
        return labels[type as keyof typeof labels] || "Related";
    }

    // Enhanced search methods for relationship discovery
    private async discoverEntityRelationships(
        entities: Entity[],
    ): Promise<RelatedContentItem[]> {
        try {
            const entityNames = entities.slice(0, 5).map((e) => e.name); // Limit to top 5 entities

            const response = await chrome.runtime.sendMessage({
                type: "searchByEntities",
                entities: entityNames,
                url: this.currentUrl, // Exclude current page
                maxResults: 5,
            });

            if (response.success && response.results) {
                return response.results.map((result: any) => ({
                    url: result.url,
                    title: result.title,
                    similarity: result.relevanceScore || 0.7,
                    relationshipType: "entity-match",
                    excerpt: `Shares entities: ${result.sharedEntities?.join(", ") || entityNames.slice(0, 2).join(", ")}`,
                }));
            }
        } catch (error) {
            console.warn("Entity relationship discovery failed:", error);
        }
        return [];
    }

    private async discoverTopicRelationships(
        topics: string[],
    ): Promise<RelatedContentItem[]> {
        try {
            const topTopics = topics.slice(0, 3); // Limit to top 3 topics

            const response = await chrome.runtime.sendMessage({
                type: "searchByTopics",
                topics: topTopics,
                url: this.currentUrl, // Exclude current page
                maxResults: 5,
            });

            if (response.success && response.results) {
                return response.results.map((result: any) => ({
                    url: result.url,
                    title: result.title,
                    similarity: result.relevanceScore || 0.6,
                    relationshipType: "topic-match",
                    excerpt: `Related topics: ${result.sharedTopics?.join(", ") || topTopics.slice(0, 2).join(", ")}`,
                }));
            }
        } catch (error) {
            console.warn("Topic relationship discovery failed:", error);
        }
        return [];
    }

    private async discoverHybridRelationships(
        summary: string,
    ): Promise<RelatedContentItem[]> {
        try {
            if (!summary || summary.length < 20) return [];

            // Use first 200 characters of summary for hybrid search
            const searchQuery = summary.substring(0, 200);

            const response = await chrome.runtime.sendMessage({
                type: "hybridSearch",
                query: searchQuery,
                url: this.currentUrl, // Exclude current page
                maxResults: 3,
            });

            if (response.success && response.results) {
                return response.results.map((result: any) => ({
                    url: result.url,
                    title: result.title,
                    similarity: result.relevanceScore || 0.5,
                    relationshipType: "content-similarity",
                    excerpt: `Similar content: ${result.snippet || "Related page content"}`,
                }));
            }
        } catch (error) {
            console.warn("Hybrid relationship discovery failed:", error);
        }
        return [];
    }

    private formatDate(dateString: string): string {
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) return "Today";
            if (diffDays === 1) return "Yesterday";
            if (diffDays < 7) return `${diffDays} days ago`;
            if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
            return date.toLocaleDateString();
        } catch {
            return "recently";
        }
    }

    // Extract domain from URL
    private extractDomainFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }

    // Calculate knowledge quality metrics for enhanced display
    private calculateKnowledgeQuality(knowledge: KnowledgeData) {
        const entityCount = knowledge.entities?.length || 0;
        const relationshipCount = knowledge.relationships?.length || 0;
        const topicCount = knowledge.keyTopics?.length || 0;
        const actionCount = knowledge.detectedActions?.length || 0;

        // Calculate component scores
        const entityScore = Math.min(entityCount * 10, 40); // Max 40 points for entities
        const relationshipScore = Math.min(relationshipCount * 15, 30); // Max 30 points for relationships
        const topicScore = Math.min(topicCount * 8, 20); // Max 20 points for topics
        const actionScore = Math.min(actionCount * 2, 10); // Max 10 points for actions

        const totalScore =
            entityScore + relationshipScore + topicScore + actionScore;

        // Determine quality level and color
        let label: string, color: string;
        if (totalScore >= 80) {
            label = "Excellent";
            color = "success";
        } else if (totalScore >= 60) {
            label = "Good";
            color = "primary";
        } else if (totalScore >= 40) {
            label = "Fair";
            color = "warning";
        } else {
            label = "Basic";
            color = "secondary";
        }

        return {
            score: totalScore,
            label,
            color,
            entities: {
                count: entityCount,
                color:
                    entityCount >= 5
                        ? "success"
                        : entityCount >= 2
                          ? "primary"
                          : "secondary",
            },
            relationships: {
                count: relationshipCount,
                color:
                    relationshipCount >= 3
                        ? "success"
                        : relationshipCount >= 1
                          ? "primary"
                          : "secondary",
            },
            topics: {
                count: topicCount,
                color:
                    topicCount >= 4
                        ? "success"
                        : topicCount >= 2
                          ? "primary"
                          : "secondary",
            },
            actions: {
                count: actionCount,
                color:
                    actionCount >= 5
                        ? "success"
                        : actionCount >= 1
                          ? "primary"
                          : "secondary",
            },
        };
    }

    // === TASK 2: ADVANCED QUERY PROCESSING UI ===

    private renderAdvancedQueryControls(): string {
        return `
            <div class="advanced-query-controls mb-3" id="advancedQueryControls" style="display: none;">
                <div class="card border-light">
                    <div class="card-header bg-light py-2">
                        <h6 class="mb-0">
                            <i class="bi bi-funnel me-2"></i>Advanced Filters
                        </h6>
                    </div>
                    <div class="card-body p-3">
                        <div class="row g-2">
                            <div class="col-md-6">
                                <label class="form-label">Content Type</label>
                                <select class="form-select form-select-sm" id="contentTypeFilter">
                                    <option value="">All Types</option>
                                    <option value="tutorial">Tutorial</option>
                                    <option value="documentation">Documentation</option>
                                    <option value="article">Article</option>
                                    <option value="reference">Reference</option>
                                    <option value="blog">Blog Post</option>
                                    <option value="news">News</option>
                                    <option value="video">Video</option>
                                </select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">Time Range</label>
                                <select class="form-select form-select-sm" id="timeRangeFilter">
                                    <option value="">All Time</option>
                                    <option value="week">Last Week</option>
                                    <option value="month">Last Month</option>
                                    <option value="quarter">Last 3 Months</option>
                                    <option value="year">Last Year</option>
                                </select>
                            </div>
                        </div>
                        <div class="row g-2 mt-2">
                            <div class="col-md-6">
                                <label class="form-label">Domain</label>
                                <input type="text" class="form-control form-control-sm" id="domainFilter" 
                                       placeholder="e.g., github.com">
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">Technical Level</label>
                                <select class="form-select form-select-sm" id="technicalLevelFilter">
                                    <option value="">Any Level</option>
                                    <option value="beginner">Beginner</option>
                                    <option value="intermediate">Intermediate</option>
                                    <option value="advanced">Advanced</option>
                                    <option value="expert">Expert</option>
                                </select>
                            </div>
                        </div>
                        <div class="row g-2 mt-2">
                            <div class="col-md-6">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="hasCodeFilter">
                                    <label class="form-check-label" for="hasCodeFilter">
                                        Has Code/Technical Content
                                    </label>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="clearFilters">
                                    <i class="bi bi-x-circle me-1"></i>Clear Filters
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private setupAdvancedQueryControls(): void {
        // Add advanced query toggle button
        const queryInput = document.getElementById("knowledgeQuery");
        if (queryInput && queryInput.parentNode) {
            const toggleButton = document.createElement("button");
            toggleButton.className = "btn btn-sm btn-outline-primary ms-2";
            toggleButton.id = "toggleAdvancedQuery";
            toggleButton.innerHTML = '<i class="bi bi-gear"></i>';
            toggleButton.title = "Advanced Search Options";

            queryInput.parentNode.appendChild(toggleButton);

            // Insert advanced controls after query input container
            const controlsHtml = this.renderAdvancedQueryControls();
            (queryInput.parentNode as Element).insertAdjacentHTML(
                "afterend",
                controlsHtml,
            );

            // Setup event listeners
            toggleButton.addEventListener("click", () => {
                const controls = document.getElementById(
                    "advancedQueryControls",
                );
                if (controls) {
                    const isVisible = controls.style.display !== "none";
                    controls.style.display = isVisible ? "none" : "block";
                    toggleButton.innerHTML = isVisible
                        ? '<i class="bi bi-gear"></i>'
                        : '<i class="bi bi-gear-fill"></i>';
                }
            });

            // Clear filters button
            document
                .getElementById("clearFilters")
                ?.addEventListener("click", () => {
                    this.clearAllFilters();
                });
        }
    }

    private clearAllFilters(): void {
        (
            document.getElementById("contentTypeFilter") as HTMLSelectElement
        ).value = "";
        (
            document.getElementById("timeRangeFilter") as HTMLSelectElement
        ).value = "";
        (document.getElementById("domainFilter") as HTMLInputElement).value =
            "";
        (
            document.getElementById("technicalLevelFilter") as HTMLSelectElement
        ).value = "";
        (document.getElementById("hasCodeFilter") as HTMLInputElement).checked =
            false;
    }

    private async submitEnhancedQuery(query: string): Promise<void> {
        const queryResults = document.getElementById("queryResults")!;

        // Collect advanced filter values
        const filters: any = {};

        const contentType = (
            document.getElementById("contentTypeFilter") as HTMLSelectElement
        )?.value;
        if (contentType) filters.contentType = contentType;

        const timeRange = (
            document.getElementById("timeRangeFilter") as HTMLSelectElement
        )?.value;
        if (timeRange) filters.timeRange = timeRange;

        const domain = (
            document.getElementById("domainFilter") as HTMLInputElement
        )?.value;
        if (domain) filters.domain = domain;

        const technicalLevel = (
            document.getElementById("technicalLevelFilter") as HTMLSelectElement
        )?.value;
        if (technicalLevel) filters.technicalLevel = technicalLevel;

        const hasCode = (
            document.getElementById("hasCodeFilter") as HTMLInputElement
        )?.checked;
        if (hasCode) filters.hasCode = true;

        queryResults.innerHTML = this.createEnhancedSearchLoadingState();

        try {
            const response = await chrome.runtime.sendMessage({
                type: "queryWebKnowledgeEnhanced",
                query: query,
                url: this.currentUrl,
                searchScope: "all_indexed",
                filters: Object.keys(filters).length > 0 ? filters : undefined,
                maxResults: 10,
            });

            this.renderEnhancedQueryResults(response);

            // Show applied filters
            if (response.metadata?.filtersApplied?.length > 0) {
                this.showAppliedFilters(response.metadata.filtersApplied);
            }
        } catch (error) {
            console.error("Error querying enhanced knowledge:", error);
            queryResults.innerHTML = this.createAlert(
                "danger",
                "bi bi-exclamation-triangle",
                "Failed to search knowledge base. Please try again.",
            );
        }
    }

    private createEnhancedSearchLoadingState(): string {
        return `
            <div class="d-flex align-items-center">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <span class="text-muted">Searching with advanced filters...</span>
            </div>
        `;
    }

    private renderEnhancedQueryResults(response: any): void {
        const queryResults = document.getElementById("queryResults")!;

        let html = `
            <div class="enhanced-query-results">
                <div class="query-answer mb-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="mb-0">Search Results</h6>
                        <div class="d-flex align-items-center">
                            <small class="text-muted me-2">
                                ${response.metadata.totalFound} found in ${response.metadata.processingTime}ms
                            </small>
                            <span class="badge bg-primary">${response.metadata.searchScope}</span>
                            ${
                                response.metadata.temporalQuery
                                    ? `<span class="badge bg-success ms-1">⏰ ${response.metadata.temporalQuery.timeframe}</span>`
                                    : ""
                            }
                        </div>
                    </div>
                    <div class="answer-text">${response.answer}</div>
                </div>
        `;

        // Show temporal query context if present
        if (response.metadata.temporalQuery) {
            html += `
                <div class="temporal-context mb-3">
                    <div class="d-flex align-items-center mb-2">
                        <i class="bi bi-clock-history text-success me-2"></i>
                        <h6 class="mb-0">Temporal Query Context</h6>
                    </div>
                    <div class="p-2 bg-light rounded">
                        <small class="text-muted d-block">
                            <strong>Timeframe:</strong> ${response.metadata.temporalQuery.timeframe} • 
                            <strong>Focus:</strong> ${response.metadata.temporalQuery.queryType} content
                        </small>
                        <small class="text-muted">
                            <strong>Detected terms:</strong> ${response.metadata.temporalQuery.extractedTimeTerms.join(", ")}
                        </small>
                    </div>
                </div>
            `;
        }

        // Show temporal patterns if present
        if (response.temporalPatterns && response.temporalPatterns.length > 0) {
            html += this.renderTemporalPatterns(response.temporalPatterns);
        }

        // Show applied filters
        if (
            response.metadata.filtersApplied &&
            response.metadata.filtersApplied.length > 0
        ) {
            html += `
                <div class="applied-filters mb-3">
                    <small class="text-muted me-2">Active filters:</small>
                    ${response.metadata.filtersApplied
                        .map(
                            (filter: string) =>
                                `<span class="badge bg-info me-1">${filter}</span>`,
                        )
                        .join("")}
                </div>
            `;
        }

        // Show sources
        if (response.sources && response.sources.length > 0) {
            html += `
                <div class="query-sources mb-3">
                    <h6 class="mb-2">Sources</h6>
                    <div class="sources-list">
                        ${response.sources
                            .map(
                                (source: any) => `
                            <div class="source-item p-2 mb-2 border rounded">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div class="flex-grow-1">
                                        <div class="fw-semibold mb-1">
                                            <a href="${source.url}" target="_blank" class="text-decoration-none">
                                                ${source.title}
                                            </a>
                                        </div>
                                        <small class="text-muted">
                                            Relevance: ${Math.round(source.relevanceScore * 100)}% • 
                                            Last indexed: ${this.formatDate(source.lastIndexed)}
                                        </small>
                                    </div>
                                    <button class="btn btn-sm btn-outline-primary source-open-btn" data-url="${source.url}">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                    </button>
                                </div>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        queryResults.innerHTML = html;
    }

    private showAppliedFilters(filters: string[]): void {
        const filtersHtml = filters
            .map(
                (filter) => `<span class="badge bg-info me-1">${filter}</span>`,
            )
            .join("");

        const container = document.getElementById("appliedFilters");
        if (container) {
            container.innerHTML = `<small class="text-muted">Filters: ${filtersHtml}</small>`;
        }
    }

    private renderTemporalPatterns(patterns: any[]): string {
        let html = `
            <div class="temporal-patterns mb-3">
                <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-graph-up-arrow text-primary me-2"></i>
                    <h6 class="mb-0">Temporal Patterns</h6>
                    <span class="badge bg-primary ms-2">${patterns.length}</span>
                </div>
        `;

        patterns.forEach((pattern, index) => {
            const typeIcon = this.getPatternTypeIcon(pattern.type);
            const confidencePercentage = Math.round(pattern.confidence * 100);

            html += `
                <div class="pattern-card border rounded p-3 mb-2">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="d-flex align-items-center">
                            <i class="${typeIcon} text-primary me-2"></i>
                            <div>
                                <div class="fw-semibold">${this.formatPatternType(pattern.type)}</div>
                                <small class="text-muted">${pattern.timespan}</small>
                            </div>
                        </div>
                        <div class="text-end">
                            <div class="progress mb-1" style="width: 60px; height: 4px;">
                                <div class="progress-bar bg-primary" 
                                     style="width: ${confidencePercentage}%" 
                                     title="Confidence: ${confidencePercentage}%">
                                </div>
                            </div>
                            <small class="text-muted">${confidencePercentage}%</small>
                        </div>
                    </div>
                    
                    <p class="mb-2 text-muted small">${pattern.description}</p>
                    
                    ${
                        pattern.items && pattern.items.length > 0
                            ? `
                        <div class="pattern-items">
                            <small class="text-muted fw-semibold">Related Pages:</small>
                            <div class="mt-1">
                                ${pattern.items
                                    .slice(0, 3)
                                    .map(
                                        (item: any) => `
                                    <div class="d-flex align-items-center mb-1">
                                        <span class="badge bg-secondary me-2">${item.contentType}</span>
                                        <small class="text-truncate flex-grow-1" title="${item.title}">
                                            ${item.title}
                                        </small>
                                        <small class="text-muted ms-2">${this.formatDate(item.visitDate)}</small>
                                    </div>
                                `,
                                    )
                                    .join("")}
                                ${
                                    pattern.items.length > 3
                                        ? `<small class="text-muted">...and ${pattern.items.length - 3} more</small>`
                                        : ""
                                }
                            </div>
                        </div>
                    `
                            : ""
                    }
                </div>
            `;
        });

        html += `</div>`;
        return html;
    }

    private getPatternTypeIcon(type: string): string {
        const icons: { [key: string]: string } = {
            learning_sequence: "bi-arrow-up-right",
            topic_progression: "bi-graph-up",
            domain_exploration: "bi-compass",
            content_evolution: "bi-arrow-clockwise",
        };
        return icons[type] || "bi-circle";
    }

    private formatPatternType(type: string): string {
        const labels: { [key: string]: string } = {
            learning_sequence: "Learning Sequence",
            topic_progression: "Topic Progression",
            domain_exploration: "Domain Exploration",
            content_evolution: "Content Evolution",
        };
        return (
            labels[type] ||
            type.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const panel = new KnowledgePanel();
    panel.initialize();
});
