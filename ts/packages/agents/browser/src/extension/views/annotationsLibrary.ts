// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Annotations Library Client
 * Provides UI for browsing and managing PDF annotations across documents
 */

// Import types from the PDF types file
import type { PDFAnnotation } from "../../views/server/features/pdf/pdfTypes";

interface UrlDocumentMapping {
    documentId: string;
    url: string;
    createdAt: string;
    lastAccessedAt: string;
}

interface AnnotationWithDocument extends PDFAnnotation {
    documentTitle: string;
}

interface FilterState {
    type: string;
    document: string;
    date: string;
    search: string;
}

type ViewMode = "grid" | "list";

class AnnotationsLibraryService {
    private baseUrl: string = "";

    async initialize(): Promise<void> {
        const viewHostUrl = await this.getViewHostUrl();
        if (viewHostUrl) {
            this.baseUrl = `${viewHostUrl}/api/pdf`;
        } else {
            // Fallback to relative URL if viewHostUrl is not available
            this.baseUrl = "/api/pdf";
        }
    }

    private async getViewHostUrl(): Promise<string | null> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getViewHostUrl",
            });
            return response?.url || null;
        } catch (error) {
            console.error("Failed to get view host URL:", error);
            return null;
        }
    }

    async getAllAnnotations(): Promise<AnnotationWithDocument[]> {
        const response = await fetch(`${this.baseUrl}/annotations/all`);
        if (!response.ok) {
            throw new Error("Failed to fetch annotations");
        }
        return response.json();
    }

    async searchAnnotations(query: string): Promise<AnnotationWithDocument[]> {
        const response = await fetch(
            `${this.baseUrl}/annotations/search?q=${encodeURIComponent(query)}`,
        );
        if (!response.ok) {
            throw new Error("Failed to search annotations");
        }
        return response.json();
    }

    generatePDFUrl(annotation: PDFAnnotation): string {
        // Extract the base view URL from the API base URL
        const viewBaseUrl = this.baseUrl.replace("/api/pdf", "");
        return `${viewBaseUrl}/pdf/?documentId=${annotation.documentId}&page=${annotation.page}&annotation=${annotation.id}`;
    }
}

class AnnotationPreviewRenderer {
    markdownToHtml(markdown: string): string {
        if (!markdown) return "";

        let html = markdown;

        // Convert basic markdown formatting
        html = html
            // Headers
            .replace(/^### (.*$)/gim, "<h3>$1</h3>")
            .replace(/^## (.*$)/gim, "<h2>$1</h2>")
            .replace(/^# (.*$)/gim, "<h1>$1</h1>")
            // Bold
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            // Italic
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            // Code
            .replace(/`(.*?)`/g, "<code>$1</code>")
            // Links
            .replace(
                /\[([^\]]+)\]\(([^)]+)\)/g,
                '<a href="$2" target="_blank">$1</a>',
            )
            // Line breaks
            .replace(/\n/g, "<br>");

        // Handle lists
        html = html.replace(/^- (.*)$/gim, "<li>$1</li>");
        html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

        return html;
    }

    escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    renderPreview(annotation: AnnotationWithDocument): string {
        let content = "";

        // Add blockquote if available
        if (annotation.metadata?.blockquoteContent) {
            content += `
                <div class="preview-blockquote">
                    <blockquote>${this.escapeHtml(annotation.metadata.blockquoteContent)}</blockquote>
                </div>
            `;
        }

        // Add screenshot if available
        if (annotation.metadata?.screenshotData) {
            content += `
                <div class="preview-screenshot">
                    <img src="${annotation.metadata.screenshotData.imageData}" alt="Screenshot" />
                </div>
            `;
        }

        // Add main content
        if (annotation.content) {
            content += `
                <div class="preview-content">
                    ${this.markdownToHtml(annotation.content)}
                </div>
            `;
        }

        return content;
    }
}

class AnnotationsLibrary {
    private service: AnnotationsLibraryService;
    private renderer: AnnotationPreviewRenderer;
    private annotations: AnnotationWithDocument[] = [];
    private filteredAnnotations: AnnotationWithDocument[] = [];
    private currentViewMode: ViewMode = "grid";
    private filters: FilterState = {
        type: "all",
        document: "all",
        date: "all",
        search: "",
    };

    constructor() {
        this.service = new AnnotationsLibraryService();
        this.renderer = new AnnotationPreviewRenderer();
        this.init();
    }

    private async init(): Promise<void> {
        // Initialize the service with the proper view host URL
        await this.service.initialize();

        this.setupEventListeners();
        await this.loadAnnotations();
    }

    private setupEventListeners(): void {
        // Search functionality
        const searchInput = document.getElementById(
            "globalSearchInput",
        ) as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener(
                "input",
                this.debounce((e: Event) => {
                    const target = e.target as HTMLInputElement;
                    this.filters.search = target.value;
                    this.applyFilters();
                }, 300),
            );
        }

        // View mode toggle
        const gridButton = document.getElementById("viewModeGrid");
        const listButton = document.getElementById("viewModeList");

        gridButton?.addEventListener("click", () => {
            this.setViewMode("grid");
        });

        listButton?.addEventListener("click", () => {
            this.setViewMode("list");
        });

        // Filter controls
        const typeFilter = document.getElementById(
            "typeFilter",
        ) as HTMLSelectElement;
        const documentFilter = document.getElementById(
            "documentFilter",
        ) as HTMLSelectElement;
        const dateFilter = document.getElementById(
            "dateFilter",
        ) as HTMLSelectElement;

        typeFilter?.addEventListener("change", (e: Event) => {
            const target = e.target as HTMLSelectElement;
            this.filters.type = target.value;
            this.applyFilters();
        });

        documentFilter?.addEventListener("change", (e: Event) => {
            const target = e.target as HTMLSelectElement;
            this.filters.document = target.value;
            this.applyFilters();
        });

        dateFilter?.addEventListener("change", (e: Event) => {
            const target = e.target as HTMLSelectElement;
            this.filters.date = target.value;
            this.applyFilters();
        });

        // Clear filters
        const clearButton = document.getElementById("clearFiltersBtn");
        clearButton?.addEventListener("click", () => {
            this.clearAllFilters();
        });
    }

    private async loadAnnotations(): Promise<void> {
        try {
            this.showLoadingState();
            this.annotations = await this.service.getAllAnnotations();
            this.populateFilterOptions();
            this.applyFilters();
            this.updateAnnotationCount();
        } catch (error) {
            console.error("Failed to load annotations:", error);
            this.showErrorState(
                "Failed to load annotations. Please try again.",
            );
        }
    }

    private populateFilterOptions(): void {
        // Populate document filter
        const documentFilter = document.getElementById(
            "documentFilter",
        ) as HTMLSelectElement;
        if (!documentFilter) return;

        const documents = [
            ...new Set(this.annotations.map((a) => a.documentTitle)),
        ].sort();

        // Clear existing options except "All Documents"
        documentFilter.innerHTML = '<option value="all">All Documents</option>';

        documents.forEach((doc) => {
            const option = document.createElement("option");
            option.value = doc;
            option.textContent = doc;
            documentFilter.appendChild(option);
        });
    }

    private applyFilters(): void {
        this.filteredAnnotations = this.annotations.filter((annotation) => {
            // Type filter
            if (
                this.filters.type !== "all" &&
                annotation.type !== this.filters.type
            ) {
                return false;
            }

            // Document filter
            if (
                this.filters.document !== "all" &&
                annotation.documentTitle !== this.filters.document
            ) {
                return false;
            }

            // Date filter
            if (this.filters.date !== "all") {
                const annotationDate = new Date(annotation.createdAt);
                const now = new Date();

                switch (this.filters.date) {
                    case "today":
                        const today = new Date(
                            now.getFullYear(),
                            now.getMonth(),
                            now.getDate(),
                        );
                        if (annotationDate < today) return false;
                        break;
                    case "week":
                        const weekAgo = new Date(
                            now.getTime() - 7 * 24 * 60 * 60 * 1000,
                        );
                        if (annotationDate < weekAgo) return false;
                        break;
                    case "month":
                        const monthAgo = new Date(
                            now.getFullYear(),
                            now.getMonth() - 1,
                            now.getDate(),
                        );
                        if (annotationDate < monthAgo) return false;
                        break;
                }
            }

            // Search filter
            if (this.filters.search) {
                const searchLower = this.filters.search.toLowerCase();
                const searchableContent = [
                    annotation.content || "",
                    annotation.metadata?.blockquoteContent || "",
                    annotation.documentTitle,
                    annotation.type,
                ]
                    .join(" ")
                    .toLowerCase();

                if (!searchableContent.includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });

        this.renderAnnotations();
        this.updateAnnotationCount();
    }

    private renderAnnotations(): void {
        const container = document.getElementById("annotationsContainer");
        if (!container) return;

        if (this.filteredAnnotations.length === 0) {
            this.showEmptyState();
            return;
        }

        const gridClass =
            this.currentViewMode === "grid"
                ? "annotations-grid"
                : "annotations-list";

        container.innerHTML = `
            <div class="${gridClass} fade-in">
                ${this.filteredAnnotations.map((annotation) => this.renderAnnotationCard(annotation)).join("")}
            </div>
        `;

        // Add click handlers for navigation
        container.querySelectorAll(".annotation-card").forEach((card) => {
            card.addEventListener("click", (e: Event) => {
                // Don't navigate if clicking on control buttons
                if ((e.target as HTMLElement).closest(".annotation-controls"))
                    return;

                const annotationId = (card as HTMLElement).dataset.annotationId;
                if (annotationId) {
                    const annotation = this.annotations.find(
                        (a) => a.id === annotationId,
                    );
                    if (annotation) {
                        this.openAnnotationInPDF(annotation);
                    }
                }
            });
        });
    }

    private renderAnnotationCard(annotation: AnnotationWithDocument): string {
        const formattedDate = this.formatDate(annotation.createdAt);
        const previewContent = this.renderer.renderPreview(annotation);

        return `
            <div class="annotation-card" data-annotation-id="${annotation.id}">
                <div class="annotation-card-header">
                    <div class="annotation-info">
                        <h4 class="annotation-type">${annotation.type}</h4>
                        <div class="annotation-meta">
                            <span class="badge badge-document">${this.escapeHtml(annotation.documentTitle)}</span>
                            <span class="badge badge-page">Page ${annotation.page}</span>
                            <span class="badge badge-type ${annotation.type}">${annotation.type}</span>
                            <span class="annotation-date">${formattedDate}</span>
                        </div>
                    </div>
                    <div class="annotation-controls">
                        <button class="btn-open" title="Open in PDF" onclick="event.stopPropagation()">
                            <i class="bi bi-box-arrow-up-right"></i>
                        </button>
                    </div>
                </div>
                
                <div class="annotation-content">
                    ${previewContent}
                </div>
            </div>
        `;
    }

    private openAnnotationInPDF(annotation: AnnotationWithDocument): void {
        const url = this.service.generatePDFUrl(annotation);
        window.open(url, "_blank");
    }

    private setViewMode(mode: ViewMode): void {
        this.currentViewMode = mode;

        // Update UI
        const gridButton = document.getElementById("viewModeGrid");
        const listButton = document.getElementById("viewModeList");

        gridButton?.classList.toggle("active", mode === "grid");
        listButton?.classList.toggle("active", mode === "list");

        // Re-render with new view mode
        this.renderAnnotations();
    }

    private clearAllFilters(): void {
        this.filters = {
            type: "all",
            document: "all",
            date: "all",
            search: "",
        };

        // Reset UI
        const searchInput = document.getElementById(
            "globalSearchInput",
        ) as HTMLInputElement;
        const typeFilter = document.getElementById(
            "typeFilter",
        ) as HTMLSelectElement;
        const documentFilter = document.getElementById(
            "documentFilter",
        ) as HTMLSelectElement;
        const dateFilter = document.getElementById(
            "dateFilter",
        ) as HTMLSelectElement;

        if (searchInput) searchInput.value = "";
        if (typeFilter) typeFilter.value = "all";
        if (documentFilter) documentFilter.value = "all";
        if (dateFilter) dateFilter.value = "all";

        this.applyFilters();
    }

    private updateAnnotationCount(): void {
        const countElement = document.getElementById("annotationCount");
        if (!countElement) return;

        const total = this.annotations.length;
        const filtered = this.filteredAnnotations.length;

        if (total === 0) {
            countElement.textContent = "No annotations found";
        } else if (filtered === total) {
            countElement.textContent = `${total} annotation${total !== 1 ? "s" : ""}`;
        } else {
            countElement.textContent = `${filtered} of ${total} annotation${total !== 1 ? "s" : ""}`;
        }
    }

    private showLoadingState(): void {
        const container = document.getElementById("annotationsContainer");
        if (!container) return;

        container.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <h6>Loading Annotations</h6>
                <p>Please wait while we load your annotation library...</p>
            </div>
        `;
    }

    private showEmptyState(): void {
        const container = document.getElementById("annotationsContainer");
        if (!container) return;

        let message = "No annotations found";
        let description = "Start annotating PDF documents to see them here.";

        if (this.annotations.length > 0) {
            message = "No annotations match your filters";
            description = "Try adjusting your search terms or filters.";
        }

        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-sticky-note"></i>
                <h6>${message}</h6>
                <p>${description}</p>
            </div>
        `;
    }

    private showErrorState(message: string): void {
        const container = document.getElementById("annotationsContainer");
        if (!container) return;

        container.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h6>Error Loading Annotations</h6>
                <p>${message}</p>
            </div>
        `;
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return "Today";
        } else if (days === 1) {
            return "Yesterday";
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    private debounce<T extends (...args: any[]) => void>(
        func: T,
        wait: number,
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout;
        return function executedFunction(...args: Parameters<T>) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new AnnotationsLibrary();
});

export default AnnotationsLibrary;
