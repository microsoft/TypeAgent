// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    notificationManager,
    extensionService,
    TemplateHelpers,
    FormatUtils,
    EventManager,
} from "./knowledgeUtilities";
import { conversation as kpLib } from "knowledge-processor";
import type {
    KnowledgeExtractionProgress,
    KnowledgeProgressCallback,
} from "../interfaces/knowledgeExtraction.types";

interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    summary: string;
    contentActions?: kpLib.Action[];
    // Enhanced content data
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics?: {
        readingTime: number;
        wordCount: number;
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
    confidence?: number;
}

interface Relationship {
    from: string;
    relationship: string;
    to: string;
    confidence?: number;
}

interface SuggestedQuestion {
    question: string;
    type:
        | "factual"
        | "analytical"
        | "comparative"
        | "exploratory"
        | "practical";
    scope: "page" | "related" | "broader";
    reasoning: string;
    confidence: number;
}

interface ChatMessage {
    id: string;
    type: "user" | "assistant";
    content: string;
    timestamp: Date;
    sources?: Array<{
        url: string;
        title: string;
        relevance: number;
    }>;
}

interface KnowledgeStatus {
    hasKnowledge: boolean;
    isExtracting: boolean;
    isIndexed: boolean;
    entityCount?: number;
    lastIndexed?: string;
}

class PageQnAPanel {
    private currentUrl: string = "";
    private isConnected: boolean = false;
    private knowledgeData: KnowledgeData | null = null;
    private knowledgeStatus: KnowledgeStatus = {
        hasKnowledge: false,
        isExtracting: false,
        isIndexed: false,
    };
    private pageQuestions: SuggestedQuestion[] = [];
    private graphQuestions: SuggestedQuestion[] = [];
    private chatHistory: ChatMessage[] = [];
    private connectionStatusCallback?: (connected: boolean) => void;

    // Streaming-related properties
    private currentExtractionId: string | null = null;
    private streamingState: {
        startTime: number;
        currentData: KnowledgeData;
    } | null = null;

    constructor() {}

    async initialize() {
        console.log("Initializing Page Q&A Panel");

        this.setupEventListeners();
        this.setupStreamingListeners();
        await this.loadCurrentPageInfo();
        await this.checkConnectionStatus();
        this.setupConnectionStatusListener();
        await this.checkKnowledgeStatus();
    }

    private setupEventListeners() {
        // Chat input handlers
        const chatInput = document.getElementById(
            "chatInput",
        ) as HTMLInputElement;
        const sendButton = document.getElementById(
            "sendButton",
        ) as HTMLButtonElement;

        if (chatInput && sendButton) {
            chatInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter" && !chatInput.disabled) {
                    this.sendMessage();
                }
            });

            sendButton.addEventListener("click", () => {
                this.sendMessage();
            });
        }

        // Retry button
        const retryButton = document.getElementById("retryButton");
        if (retryButton) {
            retryButton.addEventListener("click", () => {
                this.retryInitialization();
            });
        }

        // Setup tab change listeners
        EventManager.setupTabListeners(() => {
            this.onTabChange();
        });
    }

    private setupStreamingListeners() {
        chrome.runtime.onMessage.addListener(
            (message, sender, sendResponse) => {
                if (message.type === "knowledgeExtractionProgress") {
                    this.updateExtractionProgress(message.progress);
                } else if (message.type === "knowledgeExtractionComplete") {
                    this.handleExtractionComplete(message);
                }
            },
        );
    }

    private async loadCurrentPageInfo() {
        try {
            const tab = await extensionService.getCurrentTab();
            if (tab) {
                this.currentUrl = tab.url || "";

                const pageInfo = document.getElementById("currentPageInfo")!;
                const domain = new URL(this.currentUrl).hostname;

                pageInfo.innerHTML = this.createPageInfo(
                    tab.title || "Untitled",
                    domain,
                );
            }
        } catch (error) {
            console.error("Error loading page info:", error);
            this.showError("Failed to load page information");
        }
    }

    private createPageInfo(title: string, domain: string): string {
        const truncatedTitle =
            title.length > 50 ? title.substring(0, 50) + "..." : title;

        return `
            <div class="d-flex align-items-start">
                <div class="flex-grow-1">
                    <h6 class="mb-1">${this.escapeHtml(truncatedTitle)}</h6>
                    <small class="text-muted">${this.escapeHtml(domain)}</small>
                </div>
            </div>
        `;
    }

    private async checkKnowledgeStatus() {
        try {
            this.updateKnowledgeStatus("Checking page knowledge...");

            const status = await extensionService.getPageIndexStatus(
                this.currentUrl,
            );

            this.knowledgeStatus = {
                hasKnowledge: status.isIndexed,
                isExtracting: false,
                isIndexed: status.isIndexed,
                entityCount: status.entityCount,
                lastIndexed: status.lastIndexed,
            };

            if (status.isIndexed) {
                this.updateKnowledgeStatus("Knowledge available");
                await this.loadPageKnowledge();
                await this.enableChatInterface();
                await this.generateSuggestedQuestions();
            } else {
                this.updateKnowledgeStatus("No knowledge found");
                await this.triggerKnowledgeExtraction();
            }
        } catch (error) {
            console.error("Error checking knowledge status:", error);
            this.showError("Failed to check page knowledge");
        }
    }

    private async loadPageKnowledge() {
        try {
            // Load existing knowledge for the page
            const knowledge = await extensionService.getPageIndexedKnowledge(
                this.currentUrl,
            );
            if (knowledge) {
                this.knowledgeData = knowledge;
            }
        } catch (error) {
            console.warn("Could not load existing page knowledge:", error);
        }
    }

    private async triggerKnowledgeExtraction() {
        try {
            this.updateKnowledgeStatus("Starting knowledge extraction...");
            this.showExtractionProgress();

            const extractionId = `extraction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.currentExtractionId = extractionId;

            this.streamingState = {
                startTime: Date.now(),
                currentData: {
                    entities: [],
                    relationships: [],
                    keyTopics: [],
                    summary: "",
                    contentActions: [],
                    detectedActions: [],
                    actionSummary: undefined,
                    contentMetrics: { readingTime: 0, wordCount: 0 },
                },
            };

            const response =
                await extensionService.extractPageKnowledgeStreaming(
                    this.currentUrl,
                    "content", // Default extraction mode
                    { mode: "content" },
                    true,
                    extractionId,
                );

            if (!response) {
                throw new Error("Failed to start knowledge extraction");
            }
        } catch (error) {
            console.error("Error triggering knowledge extraction:", error);
            this.showError("Failed to extract knowledge from this page");
        }
    }

    private showExtractionProgress() {
        const progressSection = document.getElementById("extractionProgress");
        const suggestedQuestionsSection = document.getElementById(
            "suggestedQuestionsSection",
        );
        const chatSection = document.getElementById("chatSection");

        if (progressSection) progressSection.classList.remove("d-none");
        if (suggestedQuestionsSection)
            suggestedQuestionsSection.classList.add("d-none");
        if (chatSection) chatSection.classList.add("d-none");
    }

    private hideExtractionProgress() {
        const progressSection = document.getElementById("extractionProgress");
        if (progressSection) progressSection.classList.add("d-none");
    }

    private updateExtractionProgress(
        progress: KnowledgeExtractionProgress,
    ): void {
        if (
            !this.streamingState ||
            this.currentExtractionId !== progress.extractionId
        ) {
            return;
        }

        // Update progress UI
        const progressBar = document.getElementById(
            "knowledgeProgressBar",
        ) as HTMLElement;
        const statusElement = document.getElementById("knowledgeStatusMessage");
        const progressText = document.getElementById("knowledgeProgressText");

        if (statusElement) {
            const phaseMessages: Record<string, string> = {
                content: "Retrieving page content...",
                basic: "Analyzing basic information...",
                summary: "Generating summary...",
                analyzing: "Analyzing entities and topics...",
                extracting: "Extracting relationships...",
                complete: "Knowledge extraction complete!",
                error: "Extraction failed",
            };

            statusElement.textContent =
                phaseMessages[progress.phase] || progress.phase;
        }

        if (progressBar && progress.totalItems > 0) {
            const percentage = Math.round(
                (progress.processedItems / progress.totalItems) * 100,
            );
            progressBar.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
            progressBar.setAttribute("aria-valuenow", percentage.toString());
        }

        if (progressText && progress.totalItems > 0) {
            progressText.textContent = `${progress.processedItems} of ${progress.totalItems} items processed`;
        }

        // Accumulate incremental knowledge data as it arrives
        if (progress.incrementalData) {
            const data = progress.incrementalData;

            // Update entities (replace entirely with latest aggregated results)
            if (data.entities && Array.isArray(data.entities)) {
                this.streamingState.currentData.entities = data.entities;
            }

            // Update topics (replace entirely with latest aggregated results)
            if (data.keyTopics && Array.isArray(data.keyTopics)) {
                this.streamingState.currentData.keyTopics = data.keyTopics;
            }

            // Update relationships (replace entirely with latest aggregated results)
            if (data.relationships && Array.isArray(data.relationships)) {
                this.streamingState.currentData.relationships =
                    data.relationships;
            }

            // Update summary if provided
            if (data.summary) {
                this.streamingState.currentData.summary = data.summary;
            }

            // Update content metrics if provided
            if (data.contentMetrics) {
                this.streamingState.currentData.contentMetrics =
                    data.contentMetrics;
            }

            // Log progress for debugging
            console.log(`Knowledge extraction progress [${progress.phase}]:`, {
                entities: this.streamingState.currentData.entities.length,
                topics: this.streamingState.currentData.keyTopics.length,
                relationships:
                    this.streamingState.currentData.relationships.length,
            });
        }

        // Handle completion
        if (progress.phase === "complete") {
            this.handleExtractionComplete({
                success: true,
                data: this.streamingState.currentData,
            });
        } else if (progress.phase === "error") {
            this.handleExtractionComplete({
                success: false,
                error: progress.errors?.join(", ") || "Unknown error",
            });
        }
    }

    private async handleExtractionComplete(result: any) {
        this.hideExtractionProgress();

        if (result.success) {
            this.knowledgeData =
                result.data || this.streamingState?.currentData || null;
            this.knowledgeStatus.hasKnowledge = true;
            this.knowledgeStatus.isExtracting = false;

            this.updateKnowledgeStatus("Knowledge extracted successfully");

            await this.enableChatInterface();
            await this.generateSuggestedQuestions();
        } else {
            console.error("Knowledge extraction failed:", result.error);
            this.showError(result.error || "Knowledge extraction failed");
        }

        this.streamingState = null;
        this.currentExtractionId = null;
    }

    private async enableChatInterface() {
        const chatSection = document.getElementById("chatSection");
        const chatInput = document.getElementById(
            "chatInput",
        ) as HTMLInputElement;
        const sendButton = document.getElementById(
            "sendButton",
        ) as HTMLButtonElement;

        if (chatSection) chatSection.classList.remove("d-none");
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = "Ask a question about this page...";
        }
        if (sendButton) sendButton.disabled = false;
    }

    private async generateSuggestedQuestions() {
        if (!this.knowledgeData) return;

        const suggestedQuestionsSection = document.getElementById(
            "suggestedQuestionsSection",
        );
        const questionsLoading = document.getElementById("questionsLoading");

        if (suggestedQuestionsSection)
            suggestedQuestionsSection.classList.remove("d-none");
        if (questionsLoading) questionsLoading.style.display = "block";

        try {
            // Generate page-specific questions
            const pageQuestionResponse =
                await extensionService.generatePageQuestions(
                    this.currentUrl,
                    this.knowledgeData,
                );

            if (pageQuestionResponse?.questions) {
                this.pageQuestions = pageQuestionResponse.questions.filter(
                    (q: SuggestedQuestion) => q.scope === "page",
                );
                this.renderQuestions("pageQuestionsList", this.pageQuestions);
            }

            // Generate graph-based questions (broader scope)
            const graphQuestionResponse =
                await extensionService.generateGraphQuestions(
                    this.currentUrl,
                    this.knowledgeData,
                );

            if (graphQuestionResponse?.questions) {
                this.graphQuestions = graphQuestionResponse.questions.filter(
                    (q: SuggestedQuestion) => q.scope === "broader",
                );
                this.renderQuestions("graphQuestionsList", this.graphQuestions);
            }
        } catch (error) {
            console.error("Error generating questions:", error);
        } finally {
            if (questionsLoading) questionsLoading.style.display = "none";
        }
    }

    private renderQuestions(
        containerId: string,
        questions: SuggestedQuestion[],
    ) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (questions.length === 0) {
            container.innerHTML = `<div class="text-muted small">No questions available</div>`;
            return;
        }

        container.innerHTML = questions
            .map(
                (q) => `
            <div class="question-item ${q.scope === "page" ? "page-question" : "graph-question"}" 
                 data-question="${this.escapeHtml(q.question)}" 
                 tabindex="0" 
                 role="button">
                <div class="question-text">${this.escapeHtml(q.question)}</div>
                <div class="question-meta">
                    <span class="question-reasoning">${this.escapeHtml(q.reasoning)}</span>
                    <span class="question-type ${q.type}">${q.type}</span>
                </div>
            </div>
        `,
            )
            .join("");

        // Add click handlers
        container.querySelectorAll(".question-item").forEach((item) => {
            item.addEventListener("click", () => {
                const question = item.getAttribute("data-question");
                if (question) {
                    this.askQuestion(question);
                }
            });

            item.addEventListener("keypress", (e: Event) => {
                const keyEvent = e as KeyboardEvent;
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                    const question = item.getAttribute("data-question");
                    if (question) {
                        this.askQuestion(question);
                    }
                }
            });
        });
    }

    private askQuestion(question: string) {
        const chatInput = document.getElementById(
            "chatInput",
        ) as HTMLInputElement;
        if (chatInput) {
            chatInput.value = question;
            this.sendMessage();
        }
    }

    private async sendMessage() {
        const chatInput = document.getElementById(
            "chatInput",
        ) as HTMLInputElement;
        if (!chatInput || !chatInput.value.trim()) return;

        const question = chatInput.value.trim();
        chatInput.value = "";
        chatInput.disabled = true;

        // Add user message to chat
        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            type: "user",
            content: question,
            timestamp: new Date(),
        };

        this.chatHistory.push(userMessage);
        this.renderChatHistory();
        this.showThinking();

        try {
            // Send question to backend
            const response = await extensionService.queryKnowledge({
                query: question,
                url: this.currentUrl,
                searchScope: this.detectSearchScope(question),
                generateAnswer: true,
                includeRelatedEntities: true,
                limit: 10,
            });

            // Add assistant response to chat
            const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                type: "assistant",
                content:
                    response.answer ||
                    "I couldn't generate an answer for that question.",
                timestamp: new Date(),
                sources: response.sources || [],
            };

            this.chatHistory.push(assistantMessage);
            this.hideThinking();
            this.renderChatHistory();
        } catch (error) {
            console.error("Error processing question:", error);

            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                type: "assistant",
                content:
                    "Sorry, I encountered an error while processing your question. Please try again.",
                timestamp: new Date(),
            };

            this.chatHistory.push(errorMessage);
            this.hideThinking();
            this.renderChatHistory();
        } finally {
            chatInput.disabled = false;
            chatInput.focus();
        }
    }

    private detectSearchScope(
        question: string,
    ): "current_page" | "all_indexed" {
        const pageKeywords = [
            "this page",
            "here",
            "this article",
            "this content",
            "above",
            "mentioned",
        ];
        const globalKeywords = [
            "compare",
            "other",
            "similar",
            "elsewhere",
            "generally",
            "across",
        ];

        const questionLower = question.toLowerCase();

        if (pageKeywords.some((keyword) => questionLower.includes(keyword))) {
            return "current_page";
        }

        if (globalKeywords.some((keyword) => questionLower.includes(keyword))) {
            return "all_indexed";
        }

        // Default to current page for ambiguous queries
        return "current_page";
    }

    private showThinking() {
        const chatHistory = document.getElementById("chatHistory");
        if (!chatHistory) return;

        const thinkingDiv = document.createElement("div");
        thinkingDiv.id = "thinking-indicator";
        thinkingDiv.className = "thinking-indicator";
        thinkingDiv.innerHTML = `
            <span>Thinking</span>
            <div class="thinking-dots">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
        `;

        chatHistory.appendChild(thinkingDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    private hideThinking() {
        const thinkingIndicator = document.getElementById("thinking-indicator");
        if (thinkingIndicator) {
            thinkingIndicator.remove();
        }
    }

    private renderChatHistory() {
        const chatHistory = document.getElementById("chatHistory");
        if (!chatHistory) return;

        // Remove welcome message and thinking indicator
        const welcome = chatHistory.querySelector(".chat-welcome");
        if (welcome) welcome.remove();

        const thinking = document.getElementById("thinking-indicator");
        if (thinking) thinking.remove();

        // Clear and rebuild chat history
        chatHistory.innerHTML = "";

        this.chatHistory.forEach((message) => {
            const messageDiv = document.createElement("div");
            messageDiv.className = `chat-message ${message.type}`;

            let sourcesHtml = "";
            if (message.sources && message.sources.length > 0) {
                sourcesHtml = `
                    <div class="sources-section">
                        <div class="sources-title">Supporting Sources:</div>
                        ${message.sources
                            .map(
                                (source) => `
                            <div class="source-item">
                                <a href="${source.url}" target="_blank" class="source-link">${this.escapeHtml(source.title)}</a>
                                <span class="source-relevance">${Math.round(source.relevance * 100)}% relevant</span>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                `;
            }

            messageDiv.innerHTML = `
                <div class="message-bubble ${message.type}">
                    ${this.escapeHtml(message.content)}
                    ${sourcesHtml}
                </div>
                <div class="message-timestamp">
                    ${message.timestamp.toLocaleTimeString()}
                </div>
            `;

            chatHistory.appendChild(messageDiv);
        });

        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    private updateKnowledgeStatus(status: string) {
        const statusElement = document.getElementById("knowledgeStatus");
        if (statusElement) {
            statusElement.innerHTML = `<i class="bi bi-info-circle"></i> ${status}`;
        }
    }

    private showError(message: string) {
        const errorSection = document.getElementById("errorSection");
        const errorMessage = document.getElementById("errorMessage");
        const otherSections = [
            "extractionProgress",
            "suggestedQuestionsSection",
            "chatSection",
        ];

        if (errorMessage) errorMessage.textContent = message;
        if (errorSection) errorSection.classList.remove("d-none");

        otherSections.forEach((id) => {
            const section = document.getElementById(id);
            if (section) section.classList.add("d-none");
        });
    }

    private async retryInitialization() {
        const errorSection = document.getElementById("errorSection");
        if (errorSection) errorSection.classList.add("d-none");

        await this.checkKnowledgeStatus();
    }

    private async checkConnectionStatus() {
        try {
            const response = await extensionService.checkConnection();
            this.isConnected = response.connected;
            this.updateConnectionStatus();
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus");

        if (this.isConnected) {
            if (statusElement) {
                statusElement.innerHTML = `
                    <span class="status-indicator status-connected"></span>
                    Connected to TypeAgent
                `;
            }
        } else {
            if (statusElement) {
                statusElement.innerHTML = `
                    <span class="status-indicator status-disconnected"></span>
                    <span class="text-warning">Disconnected from TypeAgent</span>
                `;
            }
        }
    }

    private setupConnectionStatusListener(): void {
        this.connectionStatusCallback = (connected: boolean) => {
            this.isConnected = connected;
            this.updateConnectionStatus();
        };

        extensionService.onConnectionStatusChange(
            this.connectionStatusCallback,
        );
    }

    private async onTabChange() {
        // Reset state when tab changes
        this.chatHistory = [];
        this.pageQuestions = [];
        this.graphQuestions = [];
        this.knowledgeData = null;

        await this.loadCurrentPageInfo();
        await this.checkKnowledgeStatus();
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Initialize the panel when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const panel = new PageQnAPanel();
    await panel.initialize();
});
