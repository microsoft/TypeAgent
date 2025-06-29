// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.mjs";
import { PDFApiService } from "./services/pdfApiService";
import { PDFSSEClient } from "./services/pdfSSEClient";
import {
    TextSelectionManager,
    SelectionInfo,
} from "./core/textSelectionManager";
import {
    ContextualToolbar,
    ToolbarContext,
} from "./components/ContextualToolbar";
import { ColorPicker, HighlightColor } from "./components/ColorPicker";
import { NoteEditor, NoteData } from "./components/NoteEditor";
import { QuestionDialog, QuestionData } from "./components/QuestionDialog";
import {
    ScreenshotSelector,
    ScreenshotData,
} from "./components/ScreenshotSelector";
import { ScreenshotToolbar } from "./components/ScreenshotToolbar";
import {
    AnnotationManager,
    AnnotationCreationData,
} from "./core/annotationManager";
import { PDFJSHighlightManager } from "./core/pdfJSHighlightManager";

import "./pdf-viewer.css";
import "./styles/contextual-toolbar.css";
import "./styles/color-picker.css";
import "./styles/note-editor.css";
import "./styles/note-tooltips.css";
import "./styles/question-dialog.css";
import "./styles/annotation-styles.css";
import "./styles/screenshot-styles.css";

declare global {
    interface Window {
        pdfjsLib: any;
        pdfjsViewer: any;
    }
}

// Configure PDF.js worker
if (typeof window !== "undefined") {
    // Ensure pdfjsLib is available globally
    window.pdfjsLib = pdfjsLib;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
).toString();

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
    private screenshotSelector: ScreenshotSelector | null = null;
    private screenshotToolbar: ScreenshotToolbar | null = null;
    private annotationManager: AnnotationManager | null = null;
    private pdfJSHighlightManager: PDFJSHighlightManager | null = null;
    private wheelEventHandler: ((event: WheelEvent) => void) | null = null;

    constructor() {
        this.pdfApiService = new PDFApiService();
    }

    async initialize(): Promise<void> {
        console.log(
            "🚀 Initializing TypeAgent PDF Viewer with Complete Highlighting Support...",
        );
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

            console.log(
                "✅ PDF Viewer with Complete Highlighting initialized successfully!",
            );
        } catch (error) {
            console.error("❌ Failed to initialize PDF viewer:", error);
            this.showError(
                "Failed to initialize PDF viewer with highlighting features",
            );
        }
    }

    private async initializeHighlightingComponents(): Promise<void> {
        console.log("🎨 Initializing highlighting components...");

        this.selectionManager = new TextSelectionManager(this.pdfViewer);
        this.contextualToolbar = new ContextualToolbar();
        this.colorPicker = new ColorPicker();
        this.noteEditor = new NoteEditor();
        this.questionDialog = new QuestionDialog();
        this.screenshotSelector = new ScreenshotSelector();
        this.screenshotToolbar = new ScreenshotToolbar();
        this.annotationManager = new AnnotationManager(
            this.pdfViewer,
            this.pdfApiService,
            this.eventBus,
        );

        // Initialize PDF.js highlight manager (new hybrid approach)
        this.pdfJSHighlightManager = new PDFJSHighlightManager(
            this.pdfViewer,
            this.eventBus,
            this.pdfApiService,
        );

        // Set toolbar reference in selection manager to check dropdown state
        this.selectionManager.setContextualToolbar(this.contextualToolbar);

        this.setupHighlightingWorkflows();
        this.setupScreenshotWorkflows();
        this.setupRightClickMenu();

        console.log(
            "✅ All highlighting and screenshot components initialized successfully",
        );
    }

    private setupHighlightingWorkflows(): void {
        if (!this.selectionManager || !this.contextualToolbar) return;

        this.selectionManager.onSelectionChange((selection) => {
            // Don't hide toolbar if it's currently visible and user is interacting with it
            if (!selection || !selection.isValid) {
                // Only hide if the toolbar isn't currently visible or if no color dropdown is shown
                if (!this.contextualToolbar!.isColorDropdownVisible()) {
                    this.contextualToolbar!.hide();
                }
            } else {
                this.contextualToolbar!.show(selection);
            }
        });

        // Set up highlight color callback for dropdown
        this.contextualToolbar.setHighlightColorCallback((color, selection) => {
            this.createHighlight(selection, color);
        });

        // Set up delete callback for highlights
        this.contextualToolbar.setDeleteCallback((context) => {
            this.handleDeleteAction(context);
        });

        // Set up highlight click callback
        this.pdfJSHighlightManager.setHighlightClickCallback(
            (highlightId, highlightData, event) => {
                this.handleHighlightClick(highlightId, highlightData, event);
            },
        );

        this.contextualToolbar.addAction({
            id: "highlight",
            label: "Highlight",
            icon: "fas fa-highlighter",
            action: () => {}, // Handled by dropdown click
            hasDropdown: true,
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
            icon: "fas fa-comments",
            action: (selection) => this.handleQuestionAction(selection),
        });

        // Add delete action (only shown for existing highlights/annotations)
        this.contextualToolbar.addAction({
            id: "delete",
            label: "Delete",
            icon: "fas fa-trash",
            action: (selection, context) => {
                // This will be handled by the delete callback
            },
            condition: (selection, context) => {
                // Only show delete button for existing highlights or annotations
                return (
                    context?.type === "highlight" || context?.type === "note"
                );
            },
        });
    }

    private setupScreenshotWorkflows(): void {
        if (!this.screenshotToolbar) return;

        // Set up screenshot toolbar actions - these will replace the default placeholder actions
        const noteAction: ScreenshotAction = {
            id: "note",
            label: "Add Note",
            icon: "fas fa-sticky-note",
            action: (screenshotData) => {
                console.log("📝 Note action clicked");
                this.handleScreenshotNoteAction(screenshotData);
            },
        };

        const questionAction: ScreenshotAction = {
            id: "question",
            label: "Ask Question",
            icon: "fas fa-comments",
            action: (screenshotData) => {
                console.log("❓ Question action clicked");
                this.handleScreenshotQuestionAction(screenshotData);
            },
        };

        // Replace the default actions with working implementations
        this.screenshotToolbar.addAction(noteAction);
        this.screenshotToolbar.addAction(questionAction);
    }

    private handleHighlightAction(selection: SelectionInfo): void {
        if (!this.colorPicker || !this.selectionManager) return;
        const bounds = this.selectionManager.getSelectionBounds(selection);
        this.colorPicker.show(
            bounds.left + bounds.width / 2,
            bounds.bottom + 10,
            (color) => this.createHighlight(selection, color),
        );
    }

    private handleNoteAction(selection: SelectionInfo): void {
        if (!this.noteEditor) return;
        this.contextualToolbar?.hide();
        this.noteEditor.show(selection, (noteData) =>
            this.createNote(selection, noteData),
        );
    }

    private handleQuestionAction(selection: SelectionInfo): void {
        if (!this.questionDialog) return;
        this.contextualToolbar?.hide();
        this.questionDialog.show(selection, (questionData) =>
            this.createQuestion(selection, questionData),
        );
    }

    /**
     * Handle clicks on existing highlights
     */
    private handleHighlightClick(
        highlightId: string,
        highlightData: any,
        event: MouseEvent,
    ): void {
        console.log("🎯 Highlight clicked:", highlightId);

        // Create a fake selection for the highlight area
        const fakeSelection: SelectionInfo = {
            text: highlightData.text || "Highlighted text",
            pageNumber: highlightData.pageNumber,
            rects: [
                {
                    left: event.clientX - 10,
                    top: event.clientY - 10,
                    right: event.clientX + 10,
                    bottom: event.clientY + 10,
                    width: 20,
                    height: 20,
                } as DOMRect,
            ],
            range: document.createRange(),
            isValid: true,
        };

        // Show toolbar with highlight context
        const context: ToolbarContext = {
            type: "highlight",
            highlightId: highlightId,
            data: highlightData,
        };

        this.contextualToolbar?.show(fakeSelection, context);
    }

    /**
     * Handle delete action based on context
     */
    private handleDeleteAction(context: ToolbarContext): void {
        console.log("🗑️ Delete action triggered:", context);

        if (context.type === "highlight" && context.highlightId) {
            this.deleteHighlight(context.highlightId);
        } else if (context.type === "note" && context.annotationId) {
            this.deleteAnnotation(context.annotationId);
        }
    }

    /**
     * Delete a highlight
     */
    private async deleteHighlight(highlightId: string): Promise<void> {
        if (!this.pdfJSHighlightManager) return;

        try {
            await this.pdfJSHighlightManager.deleteHighlight(highlightId);
            console.log("✅ Highlight deleted successfully");
        } catch (error) {
            console.error("❌ Failed to delete highlight:", error);
        }
    }

    private async createHighlight(
        selection: SelectionInfo,
        color: HighlightColor,
    ): Promise<void> {
        // Use PDF.js highlight manager instead of custom annotation manager
        if (!this.pdfJSHighlightManager) {
            console.error("PDF.js highlight manager not initialized");
            return;
        }

        try {
            const highlightId =
                await this.pdfJSHighlightManager.createHighlight(
                    selection,
                    color,
                );
            if (highlightId) {
                console.log(
                    "✅ PDF.js highlight created successfully:",
                    highlightId,
                );

                // Hide toolbar and clear selection after successful highlight
                this.contextualToolbar?.hide();
                this.selectionManager?.clearSelection();
            } else {
                throw new Error("Failed to create PDF.js highlight");
            }
        } catch (error) {
            console.error("❌ Failed to create PDF.js highlight:", error);

            // Fallback to custom annotation manager for backward compatibility
            if (this.annotationManager) {
                console.log("🔄 Falling back to custom annotation manager...");
                try {
                    await this.annotationManager.createAnnotation({
                        type: "highlight",
                        selection,
                        color,
                    });
                    console.log("✅ Fallback highlight created successfully");

                    this.contextualToolbar?.hide();
                    this.selectionManager?.clearSelection();
                } catch (fallbackError) {
                    console.error(
                        "❌ Fallback highlight creation also failed:",
                        fallbackError,
                    );
                }
            }
        }
    }

    private async createNote(
        selection: SelectionInfo,
        noteData: NoteData,
    ): Promise<void> {
        if (!this.annotationManager) return;
        try {
            await this.annotationManager.createAnnotation({
                type: "note",
                selection,
                content: noteData.content,
                blockquoteContent: noteData.blockquoteContent,
                screenshotData: noteData.screenshotData,
            });
            this.selectionManager?.clearSelection();
            console.log("✅ Note created successfully");
        } catch (error) {
            console.error("❌ Failed to create note:", error);
        }
    }

    private async createQuestion(
        selection: SelectionInfo,
        questionData: QuestionData,
    ): Promise<void> {
        if (!this.annotationManager) return;
        let content = questionData.question;
        if (questionData.context)
            content += `\n\nContext: ${questionData.context}`;

        try {
            await this.annotationManager.createAnnotation({
                type: "question",
                selection,
                content,
                blockquoteContent: questionData.blockquoteContent,
                screenshotData: questionData.screenshotData,
            });
            this.selectionManager?.clearSelection();
            console.log(
                "✅ Question created successfully - ready for LLM integration",
            );
        } catch (error) {
            console.error("❌ Failed to create question:", error);
        }
    }

    private setupRightClickMenu(): void {
        document.addEventListener("contextmenu", (event: MouseEvent) => {
            const viewerContainer = document.getElementById("viewerContainer");
            if (!viewerContainer?.contains(event.target as Node)) return;
            event.preventDefault();

            const annotation = this.annotationManager?.getAnnotationAtPoint(
                event.clientX,
                event.clientY,
            );
            if (annotation) {
                this.showAnnotationContextMenu(
                    event.clientX,
                    event.clientY,
                    annotation,
                );
            } else {
                const selection = this.selectionManager?.getCurrentSelection();
                if (selection && selection.isValid)
                    this.contextualToolbar?.show(selection);
            }
        });
    }

    private showAnnotationContextMenu(
        x: number,
        y: number,
        annotation: any,
    ): void {
        const menu = document.createElement("div");
        menu.className = "annotation-context-menu visible";
        menu.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; z-index: 10005;`;
        menu.innerHTML = `
            <button class="context-menu-item" data-action="edit"><i class="fas fa-edit"></i> Edit</button>
            <div class="context-menu-separator"></div>
            <button class="context-menu-item danger" data-action="delete"><i class="fas fa-trash"></i> Delete</button>
        `;

        menu.onclick = (e) => {
            const button = (e.target as Element).closest(
                ".context-menu-item",
            ) as HTMLElement;
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
                text:
                    annotation.annotation.metadata?.blockquoteContent ||
                    "Selected text",
                pageNumber: annotation.annotation.page,
                rects: [],
                range: document.createRange(),
                isValid: true,
            };

            // Prepare existing note data
            const existingNoteData: NoteData = {
                content: annotation.annotation.content,
                blockquoteContent:
                    annotation.annotation.metadata?.blockquoteContent,
                screenshotData: annotation.annotation.metadata?.screenshotData,
            };

            this.noteEditor.show(
                fakeSelection,
                (noteData) => {
                    this.updateAnnotation(annotation.id, {
                        content: noteData.content,
                        metadata: {
                            ...annotation.annotation.metadata,
                            blockquoteContent: noteData.blockquoteContent,
                            screenshotData: noteData.screenshotData,
                        },
                    });
                },
                annotation.annotation.content,
                existingNoteData,
            );
        } else if (
            annotation.annotation.type === "question" &&
            this.questionDialog
        ) {
            const fakeSelection: SelectionInfo = {
                text:
                    annotation.annotation.metadata?.blockquoteContent ||
                    "Selected text",
                pageNumber: annotation.annotation.page,
                rects: [],
                range: document.createRange(),
                isValid: true,
            };

            // Prepare existing question data
            const existingQuestionData: QuestionData = {
                question: annotation.annotation.content,
                blockquoteContent:
                    annotation.annotation.metadata?.blockquoteContent,
                screenshotData: annotation.annotation.metadata?.screenshotData,
                context: annotation.annotation.metadata?.context,
            };

            this.questionDialog.show(
                fakeSelection,
                (questionData) => {
                    let content = questionData.question;
                    if (questionData.context)
                        content += `\n\nContext: ${questionData.context}`;

                    this.updateAnnotation(annotation.id, {
                        content: content,
                        metadata: {
                            ...annotation.annotation.metadata,
                            blockquoteContent: questionData.blockquoteContent,
                            screenshotData: questionData.screenshotData,
                            context: questionData.context,
                        },
                    });
                },
                annotation.annotation.content,
                existingQuestionData,
            );
        }
    }

    private async updateAnnotation(
        annotationId: string,
        updates: any,
    ): Promise<void> {
        try {
            await this.annotationManager?.updateAnnotation(
                annotationId,
                updates,
            );
            console.log("✅ Annotation updated successfully");
        } catch (error) {
            console.error("❌ Failed to update annotation:", error);
        }
    }

    // Screenshot functionality methods
    private startScreenshotMode(): void {
        if (!this.screenshotSelector) {
            console.error("📸 Screenshot selector not initialized!");
            return;
        }

        console.log("📸 Starting screenshot mode");
        this.screenshotSelector.startSelection(
            (screenshotData) => {
                console.log("📸 Screenshot callback received in app.ts");
                this.handleScreenshotSelection(screenshotData);
            },
            () => {
                console.log("📸 Screenshot cancelled");
                this.cancelScreenshotMode();
            },
        );
    }

    private cancelScreenshotMode(): void {
        console.log("📸 Screenshot mode cancelled");
        this.screenshotSelector?.stopSelection();
        this.screenshotSelector?.clearSelection(); // Clear the selection outline
        this.screenshotToolbar?.hide();
    }

    private handleScreenshotSelection(screenshotData: ScreenshotData): void {
        console.log("📸 Screenshot captured in app.ts:", screenshotData);

        // Stop selection mode
        this.screenshotSelector?.stopSelection();
        console.log("📸 Selection mode stopped");

        // Show flash effect
        this.showScreenshotFlash();
        console.log("📸 Flash effect shown");

        // Show toolbar with options
        if (this.screenshotToolbar) {
            console.log("📸 Showing screenshot toolbar");
            this.screenshotToolbar.show(screenshotData);
        } else {
            console.error("📸 Screenshot toolbar not available!");
        }
    }

    private showScreenshotFlash(): void {
        const flash = document.createElement("div");
        flash.className = "screenshot-capture-flash";
        document.body.appendChild(flash);

        setTimeout(() => {
            if (flash.parentNode) {
                flash.parentNode.removeChild(flash);
            }
        }, 200);
    }

    private handleScreenshotNoteAction(screenshotData: ScreenshotData): void {
        console.log("📝 Adding note to screenshot");
        this.screenshotToolbar?.hide();

        if (this.noteEditor) {
            this.noteEditor.showForScreenshot(screenshotData, (noteData) =>
                this.createScreenshotNote(screenshotData, noteData),
            );
        }
    }

    private handleScreenshotQuestionAction(
        screenshotData: ScreenshotData,
    ): void {
        console.log("❓ Asking question about screenshot");
        this.screenshotToolbar?.hide();

        if (this.questionDialog) {
            this.questionDialog.showForScreenshot(
                screenshotData,
                (questionData) =>
                    this.createScreenshotQuestion(screenshotData, questionData),
            );
        }
    }

    private async createScreenshotNote(
        screenshotData: ScreenshotData,
        noteData: NoteData,
    ): Promise<void> {
        if (!this.annotationManager) return;

        try {
            // Create a fake selection for the screenshot region
            const fakeSelection: SelectionInfo = {
                text: `Screenshot from page ${screenshotData.region.pageNumber}`,
                pageNumber: screenshotData.region.pageNumber,
                rects: [
                    {
                        left: screenshotData.region.x,
                        top: screenshotData.region.y,
                        right:
                            screenshotData.region.x +
                            screenshotData.region.width,
                        bottom:
                            screenshotData.region.y +
                            screenshotData.region.height,
                        width: screenshotData.region.width,
                        height: screenshotData.region.height,
                    } as DOMRect,
                ],
                range: document.createRange(),
                isValid: true,
            };

            await this.annotationManager.createAnnotation({
                type: "note",
                selection: fakeSelection,
                content: noteData.content,
                screenshotData: screenshotData,
            });

            console.log("✅ Screenshot note created successfully");
        } catch (error) {
            console.error("❌ Failed to create screenshot note:", error);
        }
    }

    private async createScreenshotQuestion(
        screenshotData: ScreenshotData,
        questionData: QuestionData,
    ): Promise<void> {
        if (!this.annotationManager) return;

        try {
            // Create a fake selection for the screenshot region
            const fakeSelection: SelectionInfo = {
                text: `Screenshot from page ${screenshotData.region.pageNumber}`,
                pageNumber: screenshotData.region.pageNumber,
                rects: [
                    {
                        left: screenshotData.region.x,
                        top: screenshotData.region.y,
                        right:
                            screenshotData.region.x +
                            screenshotData.region.width,
                        bottom:
                            screenshotData.region.y +
                            screenshotData.region.height,
                        width: screenshotData.region.width,
                        height: screenshotData.region.height,
                    } as DOMRect,
                ],
                range: document.createRange(),
                isValid: true,
            };

            let content = questionData.question;
            if (questionData.context)
                content += `\n\nContext: ${questionData.context}`;

            await this.annotationManager.createAnnotation({
                type: "question",
                selection: fakeSelection,
                content: content,
                screenshotData: screenshotData,
            });

            console.log(
                "✅ Screenshot question created successfully - ready for LLM integration",
            );
        } catch (error) {
            console.error("❌ Failed to create screenshot question:", error);
        }
    }

    private async setupPDFJSViewer(): Promise<void> {
        if (!window.pdfjsLib || !window.pdfjsViewer)
            throw new Error("PDF.js not loaded");

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

        const linkService = new window.pdfjsViewer.PDFLinkService({
            eventBus: this.eventBus,
        });
        this.pdfViewer = new window.pdfjsViewer.PDFViewer({
            container: viewerContainer,
            viewer: viewerElement,
            eventBus: this.eventBus,
            linkService: linkService,
            renderer: "canvas",
            textLayerMode: 2, // Enable text layer for selection
            annotationMode: 2, // Enable annotations with storage
            annotationEditorMode: -1, // Disable default annotation editor (we'll handle it manually)
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
        if (!this.documentId) return;

        try {
            // Initialize both annotation managers with document ID
            if (this.annotationManager) {
                this.annotationManager.setDocumentId(this.documentId);
                await this.annotationManager.loadAnnotations();
            }

            if (this.pdfJSHighlightManager) {
                this.pdfJSHighlightManager.setDocumentId(this.documentId);
                await this.pdfJSHighlightManager.loadHighlights();
            }

            console.log("📝 All annotations loaded and rendered");
        } catch (error) {
            console.error("❌ Failed to load annotations:", error);
        }
    }

    private setupEventHandlers(): void {
        const prevBtn = document.getElementById("prevPage");
        const nextBtn = document.getElementById("nextPage");
        const pageNumInput = document.getElementById(
            "pageNum",
        ) as HTMLInputElement;
        const zoomInBtn = document.getElementById("zoomIn");
        const zoomOutBtn = document.getElementById("zoomOut");
        const clippingBtn = document.getElementById("clippingTool");

        if (
            !prevBtn ||
            !nextBtn ||
            !pageNumInput ||
            !zoomInBtn ||
            !zoomOutBtn ||
            !clippingBtn
        ) {
            setTimeout(() => this.setupEventHandlers(), 100);
            return;
        }

        prevBtn.addEventListener("click", () => this.goToPreviousPage());
        nextBtn.addEventListener("click", () => this.goToNextPage());
        zoomInBtn.addEventListener("click", () => this.zoomIn());
        zoomOutBtn.addEventListener("click", () => this.zoomOut());
        clippingBtn.addEventListener("click", () => this.startScreenshotMode());

        pageNumInput.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            const pageNum = parseInt(target.value);
            if (
                pageNum &&
                pageNum >= 1 &&
                pageNum <= (this.pdfDoc?.numPages || 1)
            ) {
                this.goToPage(pageNum);
            } else {
                target.value = this.currentPage.toString();
            }
        });

        // Add custom zoom handler for Ctrl+scroll wheel
        this.setupZoomHandler();
    }

    /**
     * Set up custom zoom handler for Ctrl+scroll wheel
     */
    private setupZoomHandler(): void {
        const viewerContainer = document.getElementById("viewerContainer");
        if (!viewerContainer) {
            return;
        }

        // Create and store the wheel event handler
        this.wheelEventHandler = (event: WheelEvent) => {
            // Only handle zoom when Ctrl (or Cmd on Mac) is pressed
            if (event.ctrlKey || event.metaKey) {
                // Prevent default browser zoom behavior
                event.preventDefault();
                event.stopPropagation();

                // Determine zoom direction based on wheel delta
                const delta = event.deltaY;

                if (delta < 0) {
                    // Scrolling up = zoom in
                    this.zoomIn();
                } else if (delta > 0) {
                    // Scrolling down = zoom out
                    this.zoomOut();
                }
            }
        };

        viewerContainer.addEventListener("wheel", this.wheelEventHandler, {
            passive: false,
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
            this.showError(
                "Failed to load document with highlighting features",
            );
        }
    }

    private isUrl(str: string): boolean {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    }

    async loadPDFFromUrl(url: string): Promise<void> {
        try {
            const urlMapping =
                await this.pdfApiService.getDocumentIdFromUrl(url);
            this.documentId = urlMapping.documentId;
            const response = await fetch(url, {
                headers: { Accept: "application/pdf" },
            });
            if (!response.ok)
                throw new Error(`Failed to fetch PDF: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            await this.loadPDFDocument(arrayBuffer);
        } catch (error) {
            this.showError("Failed to load PDF from URL");
            throw error;
        }
    }

    async loadSampleDocument(): Promise<void> {
        const samplePdfUrl =
            "https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf";
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
        console.log(
            `📄 PDF loaded successfully: ${this.pdfDoc.numPages} pages`,
        );

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
        if (
            this.pdfViewer &&
            this.pdfDoc &&
            this.currentPage < this.pdfDoc.numPages
        ) {
            this.pdfViewer.currentPageNumber = this.currentPage + 1;
        }
    }

    async goToPage(pageNum: number): Promise<void> {
        if (
            this.pdfViewer &&
            this.pdfDoc &&
            pageNum >= 1 &&
            pageNum <= this.pdfDoc.numPages
        ) {
            this.pdfViewer.currentPageNumber = pageNum;
        }
    }

    async zoomIn(): Promise<void> {
        if (this.pdfViewer) {
            const newScale = Math.min(this.pdfViewer.currentScale * 1.2, 3.0);
            this.pdfViewer.currentScale = newScale;
            this.updateZoomDisplay();
        }
    }

    async zoomOut(): Promise<void> {
        if (this.pdfViewer) {
            const newScale = Math.max(this.pdfViewer.currentScale / 1.2, 0.3);
            this.pdfViewer.currentScale = newScale;
            this.updateZoomDisplay();
        }
    }

    /**
     * Update zoom percentage display in UI (if available)
     */
    private updateZoomDisplay(): void {
        if (this.pdfViewer) {
            const zoomPercentage = Math.round(
                this.pdfViewer.currentScale * 100,
            );

            // Update any zoom display elements if they exist
            const zoomDisplay = document.getElementById("zoomDisplay");
            if (zoomDisplay) {
                zoomDisplay.textContent = `${zoomPercentage}%`;
            }

            // Optional: Show temporary zoom indicator
            this.showZoomIndicator(zoomPercentage);
        }
    }

    /**
     * Show a temporary zoom level indicator
     */
    private showZoomIndicator(zoomPercentage: number): void {
        // Remove any existing zoom indicator
        let indicator = document.getElementById("zoomIndicator");
        if (indicator) {
            indicator.remove();
        }

        // Create new zoom indicator
        indicator = document.createElement("div");
        indicator.id = "zoomIndicator";
        indicator.textContent = `${zoomPercentage}%`;
        indicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            font-size: 18px;
            font-weight: bold;
            z-index: 10000;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;

        document.body.appendChild(indicator);

        // Fade out and remove after 1 second
        setTimeout(() => {
            if (indicator) {
                indicator.style.opacity = "0";
                setTimeout(() => {
                    if (indicator && indicator.parentNode) {
                        indicator.parentNode.removeChild(indicator);
                    }
                }, 300);
            }
        }, 700);
    }

    private updatePageCount(): void {
        const pageCountElement = document.getElementById("pageCount");
        if (pageCountElement && this.pdfDoc) {
            pageCountElement.textContent = this.pdfDoc.numPages.toString();
        }
    }

    private updateCurrentPageIndicator(): void {
        const pageNumInput = document.getElementById(
            "pageNum",
        ) as HTMLInputElement;
        const prevBtn = document.getElementById(
            "prevPage",
        ) as HTMLButtonElement;
        const nextBtn = document.getElementById(
            "nextPage",
        ) as HTMLButtonElement;

        if (pageNumInput) pageNumInput.value = this.currentPage.toString();
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn && this.pdfDoc)
            nextBtn.disabled = this.currentPage >= this.pdfDoc.numPages;
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
            this.sseClient.on("annotation-added", () =>
                this.loadAnnotationsWhenReady(),
            );
            this.sseClient.on("annotation-updated", () =>
                this.loadAnnotationsWhenReady(),
            );
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
        // Clean up zoom wheel event handler
        if (this.wheelEventHandler) {
            const viewerContainer = document.getElementById("viewerContainer");
            if (viewerContainer) {
                viewerContainer.removeEventListener(
                    "wheel",
                    this.wheelEventHandler,
                );
            }
            this.wheelEventHandler = null;
        }

        // Clean up components
        this.selectionManager?.destroy();
        this.contextualToolbar?.destroy();
        this.colorPicker?.destroy();
        this.noteEditor?.destroy();
        this.questionDialog?.destroy();
        this.screenshotSelector?.destroy();
        this.screenshotToolbar?.destroy();
        this.annotationManager?.destroy();

        if (this.sseClient) {
            try {
                (this.sseClient as any).close?.();
            } catch (error) {
                console.warn("Error closing SSE connection:", error);
            }
        }
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    console.log(
        "🚀 TypeAgent PDF Viewer with Complete Highlighting Support starting...",
    );
    try {
        const app = new TypeAgentPDFViewerApp();
        (window as any).TypeAgentPDFViewer = app;
        await app.initialize();

        console.log("🎉 PDF Viewer with Complete Highlighting Features Ready!");
        console.log(
            "✨ Features: Text selection, 8-color highlighting, markdown notes, questions, right-click menus, real-time collaboration",
        );
        console.log("🧪 Ready for end-to-end testing!");
    } catch (error) {
        console.error(
            "❌ Failed to start PDF viewer with highlighting:",
            error,
        );
    }
});

export default TypeAgentPDFViewerApp;
