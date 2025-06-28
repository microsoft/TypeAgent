// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.mjs";
import { PDFApiService } from "./services/pdfApiService";
import { PDFSSEClient } from "./services/pdfSSEClient";
import { TextSelectionManager, SelectionInfo } from "./core/textSelectionManager";
import { ContextualToolbar } from "./components/ContextualToolbar";
import { ColorPicker, HighlightColor } from "./components/ColorPicker";
import { NoteEditor, NoteData } from "./components/NoteEditor";
import { QuestionDialog, QuestionData } from "./components/QuestionDialog";
import { AnnotationManager, AnnotationCreationData } from "./core/annotationManager";

import "./pdf-viewer.css";
import "./styles/contextual-toolbar.css";
import "./styles/color-picker.css";
import "./styles/note-editor.css";
import "./styles/question-dialog.css";
import "./styles/annotation-styles.css";

declare global {
    interface Window {
        pdfjsLib: any;
        pdfjsViewer: any;
    }
}

if (typeof window !== "undefined") {
    window.pdfjsLib = pdfjsLib;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
).toString();

export class TypeAgentPDFViewerApp {
    private pdfDoc: any = null;
    private pdfViewer: any = null;
    private eventBus: any = null;
    private currentPage = 1;
    private scale = 1.0;
    private pdfApiService: PDFApiService;
    private sseClient: PDFSSEClient | null = null;
    private documentId: string | null = null;

    private selectionManager: TextSelectionManager | null = null;
    private contextualToolbar: ContextualToolbar | null = null;
    private colorPicker: ColorPicker | null = null;
    private noteEditor: NoteEditor | null = null;
    private questionDialog: QuestionDialog | null = null;
    private annotationManager: AnnotationManager | null = null;

    constructor() {
        this.pdfApiService = new PDFApiService();
    }

    async initialize(): Promise<void> {
        console.log("🚀 Initializing TypeAgent PDF Viewer with Complete Highlighting Support...");
        try {
            await this.setupPDFJSViewer();
            this.setupEventHandlers();
            await this.initializeHighlightingComponents();
            this.extractDocumentId();

            if (this.documentId) {
                await this.loadDocument(this.documentId);
            } else {
                await this.loadSampleDocument();
            }

            console.log("✅ PDF Viewer with Complete Highlighting initialized successfully!");
        } catch (error) {
            console.error("❌ Failed to initialize PDF viewer:", error);
            this.showError("Failed to initialize PDF viewer with highlighting features");
        }
    }

    private async initializeHighlightingComponents(): Promise<void> {
        console.log("🎨 Initializing highlighting components...");
        
        this.selectionManager = new TextSelectionManager(this.pdfViewer);
        this.contextualToolbar = new ContextualToolbar();
        this.colorPicker = new ColorPicker();
        this.noteEditor = new NoteEditor();
        this.questionDialog = new QuestionDialog();
        this.annotationManager = new AnnotationManager(this.pdfViewer, this.pdfApiService);

        this.setupHighlightingWorkflows();
        this.setupRightClickMenu();
        
        console.log("✅ All highlighting components initialized successfully");
    }

    private setupHighlightingWorkflows(): void {
        if (!this.selectionManager || !this.contextualToolbar) return;

        this.selectionManager.onSelectionChange((selection) => {
            if (selection && selection.isValid) {
                this.contextualToolbar!.show(selection);
            } else {
                this.contextualToolbar!.hide();
            }
        });

        this.contextualToolbar.addAction({
            id: "highlight",
            label: "Highlight",
            icon: "fas fa-highlighter",
            action: (selection) => this.handleHighlightAction(selection),
        });

        this.contextualToolbar.addAction({
            id: "note",
            label: "Add Note", 
            icon: "fas fa-sticky-note",
            action: (selection) => this.handleNoteAction(selection),
        });

        this.contextualToolbar.addAction({
            id: "question",
            label: "Ask Question",
            icon: "fas fa-question-circle", 
            action: (selection) => this.handleQuestionAction(selection),
        });
    }

    private handleHighlightAction(selection: SelectionInfo): void {
        if (!this.colorPicker || !this.selectionManager) return;
        const bounds = this.selectionManager.getSelectionBounds(selection);
        this.colorPicker.show(
            bounds.left + bounds.width / 2,
            bounds.bottom + 10,
            (color) => this.createHighlight(selection, color)
        );
    }

    private handleNoteAction(selection: SelectionInfo): void {
        if (!this.noteEditor) return;
        this.contextualToolbar?.hide();
        this.noteEditor.show(selection, (noteData) => this.createNote(selection, noteData));
    }

    private handleQuestionAction(selection: SelectionInfo): void {
        if (!this.questionDialog) return;
        this.contextualToolbar?.hide();
        this.questionDialog.show(selection, (questionData) => this.createQuestion(selection, questionData));
    }

    private async createHighlight(selection: SelectionInfo, color: HighlightColor): Promise<void> {
        if (!this.annotationManager) return;
        try {
            await this.annotationManager.createAnnotation({ type: "highlight", selection, color });
            this.contextualToolbar?.hide();
            this.selectionManager?.clearSelection();
            console.log("✅ Highlight created successfully");
        } catch (error) {
            console.error("❌ Failed to create highlight:", error);
        }
    }

    private async createNote(selection: SelectionInfo, noteData: NoteData): Promise<void> {
        if (!this.annotationManager) return;
        try {
            await this.annotationManager.createAnnotation({ type: "note", selection, content: noteData.content });
            this.selectionManager?.clearSelection();
            console.log("✅ Note created successfully");
        } catch (error) {
            console.error("❌ Failed to create note:", error);
        }
    }

    private async createQuestion(selection: SelectionInfo, questionData: QuestionData): Promise<void> {
        if (!this.annotationManager) return;
        let content = questionData.question;
        if (questionData.context) content += `\n\nContext: ${questionData.context}`;
        
        try {
            await this.annotationManager.createAnnotation({ type: "question", selection, content });
            this.selectionManager?.clearSelection();
            console.log("✅ Question created successfully - ready for LLM integration");
        } catch (error) {
            console.error("❌ Failed to create question:", error);
        }
    }

    private setupRightClickMenu(): void {
        document.addEventListener("contextmenu", (event: MouseEvent) => {
            const viewerContainer = document.getElementById("viewerContainer");
            if (!viewerContainer?.contains(event.target as Node)) return;
            event.preventDefault();
            
            const annotation = this.annotationManager?.getAnnotationAtPoint(event.clientX, event.clientY);
            if (annotation) {
                this.showAnnotationContextMenu(event.clientX, event.clientY, annotation);
            } else {
                const selection = this.selectionManager?.getCurrentSelection();
                if (selection && selection.isValid) this.contextualToolbar?.show(selection);
            }
        });
    }

    private showAnnotationContextMenu(x: number, y: number, annotation: any): void {
        const menu = document.createElement("div");
        menu.className = "annotation-context-menu visible";
        menu.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; z-index: 10005;`;
        menu.innerHTML = `
            <button class="context-menu-item" data-action="edit"><i class="fas fa-edit"></i> Edit</button>
            <div class="context-menu-separator"></div>
            <button class="context-menu-item danger" data-action="delete"><i class="fas fa-trash"></i> Delete</button>
        `;
        
        menu.onclick = (e) => {
            const button = (e.target as Element).closest(".context-menu-item") as HTMLElement;
            if (!button) return;
            const action = button.getAttribute("data-action");
            if (action === "delete") this.deleteAnnotation(annotation.id);
            else if (action === "edit") this.editAnnotation(annotation);
            menu.remove();
        };
        
        document.body.appendChild(menu);
        setTimeout(() => {
            const removeOnClick = (e: Event) => {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    document.removeEventListener("click", removeOnClick);
                }
            };
            document.addEventListener("click", removeOnClick);
        }, 100);
    }

    private async deleteAnnotation(annotationId: string): Promise<void> {
        try {
            await this.annotationManager?.deleteAnnotation(annotationId);
            console.log("✅ Annotation deleted successfully");
        } catch (error) {
            console.error("❌ Failed to delete annotation:", error);
        }
    }

    private editAnnotation(annotation: any): void {
        if (annotation.annotation.type === "note" && this.noteEditor) {
            const fakeSelection: SelectionInfo = {
                text: "Selected text",
                pageNumber: annotation.annotation.page,
                rects: [],
                range: document.createRange(),
                isValid: true,
            };
            this.noteEditor.show(fakeSelection, (noteData) => {
                this.updateAnnotation(annotation.id, { content: noteData.content });
            }, annotation.annotation.content);
        }
    }

    private async updateAnnotation(annotationId: string, updates: any): Promise<void> {
        try {
            await this.annotationManager?.updateAnnotation(annotationId, updates);
            console.log("✅ Annotation updated successfully");
        } catch (error) {
            console.error("❌ Failed to update annotation:", error);
        }
    }

    private async setupPDFJSViewer(): Promise<void> {
        if (!window.pdfjsLib || !window.pdfjsViewer) throw new Error("PDF.js not loaded");

        this.eventBus = new window.pdfjsViewer.EventBus();
        const viewerContainer = document.getElementById("viewerContainer");
        if (!viewerContainer) throw new Error("Viewer container not found");

        // Ensure we have a clean viewer element (don't replace if it exists and is valid)
        let viewerElement = document.getElementById("viewer");
        if (!viewerElement) {
            viewerElement = document.createElement("div");
            viewerElement.id = "viewer";
            viewerElement.className = "pdfViewer";
            viewerContainer.appendChild(viewerElement);
        }

        const toolbar = document.querySelector(".toolbar") as HTMLElement;
        const toolbarHeight = toolbar ? toolbar.offsetHeight : 56;
        
        viewerContainer.style.cssText = `
            position: absolute; top: ${toolbarHeight}px; left: 0; right: 0; bottom: 0; overflow: auto;
        `;

        const linkService = new window.pdfjsViewer.PDFLinkService({ eventBus: this.eventBus });
        this.pdfViewer = new window.pdfjsViewer.PDFViewer({
            container: viewerContainer,
            viewer: viewerElement,
            eventBus: this.eventBus,
            linkService: linkService,
            renderer: "canvas",
            textLayerMode: 2,
            annotationMode: 2,
            removePageBorders: false,
            l10n: window.pdfjsViewer.NullL10n,
        });

        linkService.setViewer(this.pdfViewer);

        this.eventBus.on("pagesinit", () => {
            console.log("📄 PDF pages initialized");
            this.loadAnnotationsWhenReady();
            this.hideLoadingState();
        });

        this.eventBus.on("pagechanging", (evt: any) => {
            this.currentPage = evt.pageNumber;
            this.updateCurrentPageIndicator();
        });

        this.eventBus.on("scalechanging", (evt: any) => {
            this.scale = evt.scale;
            this.updateScaleIndicator();
        });
    }

    private async loadAnnotationsWhenReady(): Promise<void> {
        if (!this.annotationManager || !this.documentId) return;
        try {
            this.annotationManager.setDocumentId(this.documentId);
            await this.annotationManager.loadAnnotations();
            console.log("📝 Annotations loaded and rendered");
        } catch (error) {
            console.error("❌ Failed to load annotations:", error);
        }
    }

    private setupEventHandlers(): void {
        const prevBtn = document.getElementById("prevPage");
        const nextBtn = document.getElementById("nextPage");
        const pageNumInput = document.getElementById("pageNum") as HTMLInputElement;
        const zoomInBtn = document.getElementById("zoomIn");
        const zoomOutBtn = document.getElementById("zoomOut");

        if (!prevBtn || !nextBtn || !pageNumInput || !zoomInBtn || !zoomOutBtn) {
            setTimeout(() => this.setupEventHandlers(), 100);
            return;
        }

        prevBtn.addEventListener("click", () => this.goToPreviousPage());
        nextBtn.addEventListener("click", () => this.goToNextPage());
        zoomInBtn.addEventListener("click", () => this.zoomIn());
        zoomOutBtn.addEventListener("click", () => this.zoomOut());

        pageNumInput.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            const pageNum = parseInt(target.value);
            if (pageNum && pageNum >= 1 && pageNum <= (this.pdfDoc?.numPages || 1)) {
                this.goToPage(pageNum);
            } else {
                target.value = this.currentPage.toString();
            }
        });
    }

    private extractDocumentId(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const fileUrl = urlParams.get("url") || urlParams.get("file");
        if (fileUrl) this.documentId = fileUrl;
    }

    async loadDocument(documentId: string): Promise<void> {
        try {
            this.showLoading("Loading document with highlighting support...");
            if (this.isUrl(documentId)) {
                await this.loadPDFFromUrl(documentId);
            } else {
                await this.loadSampleDocument();
            }
            if (this.documentId) this.setupSSEConnection(this.documentId);
        } catch (error) {
            console.error("❌ Failed to load document:", error);
            this.showError("Failed to load document with highlighting features");
        }
    }

    private isUrl(str: string): boolean {
        try { new URL(str); return true; } catch { return false; }
    }

    async loadPDFFromUrl(url: string): Promise<void> {
        try {
            const urlMapping = await this.pdfApiService.getDocumentIdFromUrl(url);
            this.documentId = urlMapping.documentId;
            const response = await fetch(url, { headers: { Accept: "application/pdf" } });
            if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            await this.loadPDFDocument(arrayBuffer);
        } catch (error) {
            this.showError("Failed to load PDF from URL");
            throw error;
        }
    }

    async loadSampleDocument(): Promise<void> {
        const samplePdfUrl = "https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf";
        await this.loadPDFFromUrl(samplePdfUrl);
    }

    private async loadPDFDocument(data: ArrayBuffer): Promise<void> {
        console.log("📄 Loading PDF document...");
        const loadingTask = window.pdfjsLib.getDocument({
            data: data,
            cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.3.31/cmaps/",
            cMapPacked: true,
        });

        this.pdfDoc = await loadingTask.promise;
        console.log(`📄 PDF loaded successfully: ${this.pdfDoc.numPages} pages`);
        
        if (!this.pdfViewer) {
            console.error("❌ PDF viewer not initialized!");
            throw new Error("PDF viewer not initialized");
        }
        
        this.pdfViewer.setDocument(this.pdfDoc);
        console.log("📄 Document set on viewer");
        
        this.updatePageCount();
        this.currentPage = 1;
        console.log("📄 PDF document loading complete");
        
        // Fallback: Hide loading state after a delay if pagesinit doesn't fire
        setTimeout(() => {
            console.log("📄 Fallback: Hiding loading state");
            this.hideLoadingState();
        }, 2000);
    }

    async goToPreviousPage(): Promise<void> {
        if (this.pdfViewer && this.currentPage > 1) {
            this.pdfViewer.currentPageNumber = this.currentPage - 1;
        }
    }

    async goToNextPage(): Promise<void> {
        if (this.pdfViewer && this.pdfDoc && this.currentPage < this.pdfDoc.numPages) {
            this.pdfViewer.currentPageNumber = this.currentPage + 1;
        }
    }

    async goToPage(pageNum: number): Promise<void> {
        if (this.pdfViewer && this.pdfDoc && pageNum >= 1 && pageNum <= this.pdfDoc.numPages) {
            this.pdfViewer.currentPageNumber = pageNum;
        }
    }

    async zoomIn(): Promise<void> {
        if (this.pdfViewer) {
            this.pdfViewer.currentScale = Math.min(this.pdfViewer.currentScale * 1.2, 3.0);
        }
    }

    async zoomOut(): Promise<void> {
        if (this.pdfViewer) {
            this.pdfViewer.currentScale = Math.max(this.pdfViewer.currentScale / 1.2, 0.3);
        }
    }

    private updatePageCount(): void {
        const pageCountElement = document.getElementById("pageCount");
        if (pageCountElement && this.pdfDoc) {
            pageCountElement.textContent = this.pdfDoc.numPages.toString();
        }
    }

    private updateCurrentPageIndicator(): void {
        const pageNumInput = document.getElementById("pageNum") as HTMLInputElement;
        const prevBtn = document.getElementById("prevPage") as HTMLButtonElement;
        const nextBtn = document.getElementById("nextPage") as HTMLButtonElement;

        if (pageNumInput) pageNumInput.value = this.currentPage.toString();
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn && this.pdfDoc) nextBtn.disabled = this.currentPage >= this.pdfDoc.numPages;
    }

    private updateScaleIndicator(): void {
        const scaleElement = document.getElementById("scale");
        if (scaleElement) {
            scaleElement.textContent = Math.round(this.scale * 100) + "%";
        }
    }

    private setupSSEConnection(documentId: string): void {
        try {
            this.sseClient = new PDFSSEClient(documentId);
            this.sseClient.on("annotation-added", () => this.loadAnnotationsWhenReady());
            this.sseClient.on("annotation-updated", () => this.loadAnnotationsWhenReady());
        } catch (error) {
            console.warn("⚠️ Failed to set up SSE connection:", error);
        }
    }

    private showLoading(message: string): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            // Remove any existing loading element
            const existingLoading = container.querySelector(".loading");
            if (existingLoading) {
                existingLoading.remove();
            }
            
            // Add loading element without replacing entire content
            const loadingDiv = document.createElement("div");
            loadingDiv.className = "loading";
            loadingDiv.innerHTML = `🔄 ${message}`;
            loadingDiv.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1000;
                font-size: 16px;
                text-align: center;
            `;
            container.appendChild(loadingDiv);
        }
    }

    private hideLoadingState(): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            // Remove any loading content but preserve the viewer structure
            const loadingElement = container.querySelector(".loading");
            if (loadingElement) {
                loadingElement.remove();
            }
            
            // Ensure viewer element exists
            let viewerElement = document.getElementById("viewer");
            if (!viewerElement) {
                viewerElement = document.createElement("div");
                viewerElement.id = "viewer";
                viewerElement.className = "pdfViewer";
                container.appendChild(viewerElement);
            }
        }
    }

    private showError(message: string): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            container.innerHTML = `<div class="error"><div>❌ Error</div><p>${message}</p></div>`;
        }
    }

    destroy(): void {
        this.selectionManager?.destroy();
        this.contextualToolbar?.destroy();
        this.colorPicker?.destroy();
        this.noteEditor?.destroy();
        this.questionDialog?.destroy();
        this.annotationManager?.destroy();
        if (this.sseClient) {
            try { (this.sseClient as any).close?.(); } catch (error) {
                console.warn("Error closing SSE connection:", error);
            }
        }
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 TypeAgent PDF Viewer with Complete Highlighting Support starting...");
    try {
        const app = new TypeAgentPDFViewerApp();
        (window as any).TypeAgentPDFViewer = app;
        await app.initialize();
        
        console.log("🎉 PDF Viewer with Complete Highlighting Features Ready!");
        console.log("✨ Features: Text selection, 8-color highlighting, markdown notes, questions, right-click menus, real-time collaboration");
        console.log("🧪 Ready for end-to-end testing!");
    } catch (error) {
        console.error("❌ Failed to start PDF viewer with highlighting:", error);
    }
});

export default TypeAgentPDFViewerApp;