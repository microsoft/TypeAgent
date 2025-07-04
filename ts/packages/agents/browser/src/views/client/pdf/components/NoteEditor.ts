// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SelectionInfo } from "../core/textSelectionManager";
import { ScreenshotData } from "./ScreenshotSelector";
import DOMPurify from "dompurify";

/**
 * Note Editor Component
 * Provides markdown editor for adding notes to selected text or screenshots
 */

export interface NoteData {
    content: string;
    selectedText?: string;
    screenshotData?: ScreenshotData;
    blockquoteContent?: string; // Store the blockquote separately
}

export type NoteSaveCallback = (noteData: NoteData) => void;

export class NoteEditor {
    private element: HTMLElement | null = null;
    private isVisible = false;
    private callback: NoteSaveCallback | null = null;
    private currentSelection: SelectionInfo | null = null;
    private currentScreenshot: ScreenshotData | null = null;

    constructor() {
        this.createEditorElement();
        this.setupEventListeners();
    }

    /**
     * Show note editor for selected text with existing note data
     */
    show(
        selection: SelectionInfo,
        callback: NoteSaveCallback,
        existingNote?: string,
        existingNoteData?: NoteData,
    ): void {
        this.currentSelection = selection;
        this.currentScreenshot = null;
        this.showEditor(callback, existingNote, existingNoteData);
    }

    /**
     * Show note editor for screenshot with existing note data
     */
    showForScreenshot(
        screenshot: ScreenshotData,
        callback: NoteSaveCallback,
        existingNote?: string,
        existingNoteData?: NoteData,
    ): void {
        this.currentSelection = null;
        this.currentScreenshot = screenshot;
        this.showEditor(callback, existingNote, existingNoteData);
    }

    /**
     * Common show logic for both text and screenshot
     */
    private showEditor(
        callback: NoteSaveCallback,
        existingNote?: string,
        existingNoteData?: NoteData,
    ): void {
        if (!this.element) return;

        this.callback = callback;

        // Populate the editor
        this.populateEditor(existingNote, existingNoteData);

        // Show the modal
        this.element.classList.add("visible");
        this.isVisible = true;

        // Focus the editor
        const textArea = this.element.querySelector(
            ".note-editor-textarea",
        ) as HTMLTextAreaElement;
        if (textArea) {
            textArea.focus();
            // Position cursor at end if there's existing content
            if (existingNote) {
                textArea.setSelectionRange(
                    textArea.value.length,
                    textArea.value.length,
                );
            }
        }
    }

    /**
     * Hide the note editor
     */
    hide(): void {
        if (!this.element || !this.isVisible) return;

        this.element.classList.remove("visible");
        this.isVisible = false;
        this.currentSelection = null;
        this.currentScreenshot = null;
        this.callback = null;
    }

    /**
     * Check if editor is visible
     */
    isEditorVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Create the editor DOM element
     */
    private createEditorElement(): void {
        this.element = document.createElement("div");
        this.element.className = "note-editor-modal";

        this.element.innerHTML = `
            <div class="note-editor-backdrop"></div>
            <div class="note-editor-container">
                <div class="note-editor-header">
                    <h3 class="editor-title">Add Note</h3>
                    <button type="button" class="close-button" aria-label="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="note-editor-content">
                    <div class="selected-content-section">
                        <label class="section-label">Selected Content:</label>
                        <div class="selected-content-container">
                            <!-- Selected text or screenshot will be inserted here -->
                        </div>
                    </div>
                    
                    <div class="note-content-section">
                        <label class="section-label" for="note-textarea">Note Content (Markdown supported):</label>
                        <textarea 
                            id="note-textarea"
                            class="note-editor-textarea" 
                            placeholder="Write your note here... You can use markdown formatting."
                            rows="8"
                        ></textarea>
                        
                        <div class="editor-help">
                            <details>
                                <summary>Markdown formatting help</summary>
                                <div class="markdown-help-content">
                                    <code>**bold**</code> → <strong>bold</strong><br>
                                    <code>*italic*</code> → <em>italic</em><br>
                                    <code>\`code\`</code> → <code>code</code><br>
                                    <code># Heading</code> → Heading<br>
                                    <code>- List item</code> → • List item<br>
                                    <code>[link](url)</code> → link
                                </div>
                            </details>
                        </div>
                    </div>
                    
                    <div class="note-preview-section" style="display: none;">
                        <label class="section-label">Preview:</label>
                        <div class="note-preview-content">
                            <!-- Preview will be rendered here -->
                        </div>
                    </div>
                </div>
                
                <div class="note-editor-footer">
                    <div class="editor-actions-left">
                        <button type="button" class="preview-toggle-button">
                            <i class="fas fa-eye"></i>
                            Preview
                        </button>
                    </div>
                    <div class="editor-actions-right">
                        <button type="button" class="cancel-button">
                            Cancel
                        </button>
                        <button type="button" class="save-button">
                            <i class="fas fa-save"></i>
                            Save Note
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add to document body
        document.body.appendChild(this.element);
    }

    /**
     * Populate editor with selection/screenshot and existing note content
     */
    private populateEditor(
        existingNote?: string,
        existingNoteData?: NoteData,
    ): void {
        if (!this.element) return;

        // Set content based on type (text selection or screenshot)
        const selectedContentSection = this.element.querySelector(
            ".selected-content-section",
        );
        if (selectedContentSection) {
            if (this.currentSelection) {
                // Text selection mode - use existing blockquote if available
                const blockquoteText =
                    existingNoteData?.blockquoteContent ||
                    this.currentSelection.text;
                selectedContentSection.innerHTML = `
                    <label class="section-label">Selected Text:</label>
                    <blockquote class="selected-text-quote">
                        ${this.escapeHtml(blockquoteText)}
                    </blockquote>
                `;
            } else if (this.currentScreenshot) {
                // Screenshot mode - show existing screenshot if available
                const screenshotData =
                    existingNoteData?.screenshotData || this.currentScreenshot;
                selectedContentSection.innerHTML = `
                    <label class="section-label">Selected Screenshot:</label>
                    <div class="selected-screenshot">
                        <img src="${screenshotData.imageData}" alt="Screenshot clipping" class="screenshot-preview" />
                        <div class="screenshot-info">
                            <small>Page ${screenshotData.region.pageNumber} • ${screenshotData.region.width}×${screenshotData.region.height}px</small>
                        </div>
                    </div>
                `;
            }
        }

        // Set existing note content if provided
        const textArea = this.element.querySelector(
            ".note-editor-textarea",
        ) as HTMLTextAreaElement;
        if (textArea) {
            textArea.value = existingNote || "";
        }

        // Update preview if in preview mode
        this.updatePreview();
    }

    /**
     * Escape HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        if (!this.element) return;

        // Close button
        const closeButton = this.element.querySelector(".close-button");
        closeButton?.addEventListener("click", () => this.hide());

        // Cancel button
        const cancelButton = this.element.querySelector(".cancel-button");
        cancelButton?.addEventListener("click", () => this.hide());

        // Save button
        const saveButton = this.element.querySelector(".save-button");
        saveButton?.addEventListener("click", () => this.handleSave());

        // Preview toggle
        const previewButton = this.element.querySelector(
            ".preview-toggle-button",
        );
        previewButton?.addEventListener("click", () => this.togglePreview());

        // Backdrop click to close
        const backdrop = this.element.querySelector(".note-editor-backdrop");
        backdrop?.addEventListener("click", () => this.hide());

        // Prevent modal content clicks from closing
        const container = this.element.querySelector(".note-editor-container");
        container?.addEventListener("click", (e) => e.stopPropagation());

        // Update preview on text change
        const textArea = this.element.querySelector(".note-editor-textarea");
        textArea?.addEventListener("input", () => this.updatePreview());

        // Keyboard shortcuts
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Handle save action
     */
    private handleSave = (): void => {
        if (
            (!this.currentSelection && !this.currentScreenshot) ||
            !this.callback
        )
            return;

        const textArea = this.element?.querySelector(
            ".note-editor-textarea",
        ) as HTMLTextAreaElement;
        if (!textArea) return;

        const content = textArea.value.trim();
        if (!content) {
            // Show error for empty content
            this.showError("Please enter some content for your note.");
            return;
        }

        const noteData: NoteData = {
            content,
            selectedText: this.currentSelection?.text,
            screenshotData: this.currentScreenshot || undefined,
            blockquoteContent: this.currentSelection?.text, // Store blockquote content separately
        };

        try {
            this.callback(noteData);
            this.hide();
        } catch (error) {
            console.error("Error saving note:", error);
            this.showError("Failed to save note. Please try again.");
        }
    };

    /**
     * Toggle preview mode
     */
    private togglePreview(): void {
        if (!this.element) return;

        const previewSection = this.element.querySelector(
            ".note-preview-section",
        ) as HTMLElement;
        const previewButton = this.element.querySelector(
            ".preview-toggle-button",
        ) as HTMLElement;

        const isVisible = previewSection.style.display !== "none";

        if (isVisible) {
            previewSection.style.display = "none";
            previewButton.innerHTML = '<i class="fas fa-eye"></i> Preview';
        } else {
            previewSection.style.display = "block";
            previewButton.innerHTML =
                '<i class="fas fa-eye-slash"></i> Hide Preview';
            this.updatePreview();
        }
    }

    /**
     * Update preview content
     */
    private updatePreview(): void {
        if (!this.element) return;

        const textArea = this.element.querySelector(
            ".note-editor-textarea",
        ) as HTMLTextAreaElement;
        const previewContent = this.element.querySelector(
            ".note-preview-content",
        );

        if (!textArea || !previewContent) return;

        const markdown = textArea.value;
        const html = this.markdownToHtml(markdown);
        const sanitizedHtml = DOMPurify.sanitize(html);
        previewContent.innerHTML = sanitizedHtml;
    }

    /**
     * Simple markdown to HTML converter
     * Note: In a real implementation, you might want to use a proper markdown library
     */
    private markdownToHtml(markdown: string): string {
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

    /**
     * Show error message
     */
    private showError(message: string): void {
        // Create temporary error message
        const errorDiv = document.createElement("div");
        errorDiv.className = "note-editor-error";
        errorDiv.textContent = message;

        const footer = this.element?.querySelector(".note-editor-footer");
        if (footer) {
            footer.insertBefore(errorDiv, footer.firstChild);

            // Remove error after 3 seconds
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 3000);
        }
    }

    /**
     * Handle keyboard shortcuts
     */
    private handleKeyDown = (event: KeyboardEvent): void => {
        if (!this.isVisible) return;

        // ESC to close
        if (event.key === "Escape") {
            this.hide();
        }

        // Ctrl+Enter or Cmd+Enter to save
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            this.handleSave();
        }

        // Ctrl+P or Cmd+P to toggle preview
        if ((event.ctrlKey || event.metaKey) && event.key === "p") {
            event.preventDefault();
            this.togglePreview();
        }
    };

    /**
     * Clean up and remove editor
     */
    destroy(): void {
        document.removeEventListener("keydown", this.handleKeyDown);

        if (this.element) {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }

        this.element = null;
        this.isVisible = false;
        this.currentSelection = null;
        this.currentScreenshot = null;
        this.callback = null;
    }
}
