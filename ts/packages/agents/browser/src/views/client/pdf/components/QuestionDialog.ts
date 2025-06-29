// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SelectionInfo } from "../core/textSelectionManager";
import { ScreenshotData } from "./ScreenshotSelector";

/**
 * Question Dialog Component
 * Provides interface for asking questions about selected text or screenshots
 */

export interface QuestionData {
    question: string;
    selectedText?: string;
    screenshotData?: ScreenshotData;
    context?: string;
    blockquoteContent?: string; // Store the blockquote separately
}

export type QuestionSubmitCallback = (questionData: QuestionData) => void;

export class QuestionDialog {
    private element: HTMLElement | null = null;
    private isVisible = false;
    private callback: QuestionSubmitCallback | null = null;
    private currentSelection: SelectionInfo | null = null;
    private currentScreenshot: ScreenshotData | null = null;

    constructor() {
        this.createDialogElement();
        this.setupEventListeners();
    }

    /**
     * Show question dialog for selected text with existing question data
     */
    show(
        selection: SelectionInfo,
        callback: QuestionSubmitCallback,
        existingQuestion?: string,
        existingQuestionData?: QuestionData,
    ): void {
        this.currentSelection = selection;
        this.currentScreenshot = null;
        this.showDialog(callback, existingQuestion, existingQuestionData);
    }

    /**
     * Show question dialog for screenshot with existing question data
     */
    showForScreenshot(
        screenshot: ScreenshotData,
        callback: QuestionSubmitCallback,
        existingQuestion?: string,
        existingQuestionData?: QuestionData,
    ): void {
        this.currentSelection = null;
        this.currentScreenshot = screenshot;
        this.showDialog(callback, existingQuestion, existingQuestionData);
    }

    /**
     * Common show logic for both text and screenshot
     */
    private showDialog(
        callback: QuestionSubmitCallback,
        existingQuestion?: string,
        existingQuestionData?: QuestionData,
    ): void {
        if (!this.element) return;

        this.callback = callback;

        // Populate the dialog
        this.populateDialog(existingQuestion, existingQuestionData);

        // Show the modal
        this.element.classList.add("visible");
        this.isVisible = true;

        // Focus the question input
        const questionInput = this.element.querySelector(
            ".question-input",
        ) as HTMLTextAreaElement;
        if (questionInput) {
            questionInput.focus();
            // Position cursor at end if there's existing content
            if (existingQuestion) {
                questionInput.setSelectionRange(
                    questionInput.value.length,
                    questionInput.value.length,
                );
            }
        }
    }

    /**
     * Hide the question dialog
     */
    hide(): void {
        if (!this.element || !this.isVisible) return;

        this.element.classList.remove("visible");
        this.isVisible = false;
        this.currentSelection = null;
        this.currentScreenshot = null;
        this.callback = null;

        // Clear form
        this.clearForm();
    }

    /**
     * Check if dialog is visible
     */
    isDialogVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Create the dialog DOM element
     */
    private createDialogElement(): void {
        this.element = document.createElement("div");
        this.element.className = "question-dialog-modal";

        this.element.innerHTML = `
            <div class="question-dialog-backdrop"></div>
            <div class="question-dialog-container">
                <div class="question-dialog-header">
                    <h3 class="dialog-title">
                        <i class="fas fa-comments"></i>
                        Ask a Question
                    </h3>
                    <button type="button" class="close-button" aria-label="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="question-dialog-content">
                    <div class="selected-content-section">
                        <label class="section-label">Selected Content:</label>
                        <div class="selected-content-container">
                            <!-- Selected text or screenshot will be inserted here -->
                        </div>
                    </div>
                    
                    <div class="question-section">
                        <label class="section-label" for="question-input">Your Question:</label>
                        <textarea 
                            id="question-input"
                            class="question-input" 
                            placeholder="What would you like to know about this text?"
                            rows="3"
                        ></textarea>
                        
                        <div class="question-examples">
                            <span class="examples-label">Examples:</span>
                            <div class="example-questions">
                                <button type="button" class="example-question" data-question="What does this mean?">
                                    "What does this mean?"
                                </button>
                                <button type="button" class="example-question" data-question="Can you explain this in simpler terms?">
                                    "Can you explain this in simpler terms?"
                                </button>
                                <button type="button" class="example-question" data-question="What are the implications of this?">
                                    "What are the implications of this?"
                                </button>
                                <button type="button" class="example-question" data-question="How does this relate to the broader context?">
                                    "How does this relate to the broader context?"
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="context-section">
                        <label class="section-label" for="context-input">Additional Context (Optional):</label>
                        <textarea 
                            id="context-input"
                            class="context-input" 
                            placeholder="Provide any additional context that might help answer your question..."
                            rows="2"
                        ></textarea>
                    </div>
                </div>
                
                <div class="question-dialog-footer">
                    <div class="dialog-actions">
                        <button type="button" class="cancel-button">
                            Cancel
                        </button>
                        <button type="button" class="submit-button">
                            <i class="fas fa-paper-plane"></i>
                            Ask Question
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add to document body
        document.body.appendChild(this.element);
    }

    /**
     * Populate dialog with selection or screenshot and existing question data
     */
    private populateDialog(
        existingQuestion?: string,
        existingQuestionData?: QuestionData,
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
                    existingQuestionData?.blockquoteContent ||
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
                    existingQuestionData?.screenshotData ||
                    this.currentScreenshot;
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

        // Set existing question and context content if provided
        const questionInput = this.element.querySelector(
            ".question-input",
        ) as HTMLTextAreaElement;
        const contextInput = this.element.querySelector(
            ".context-input",
        ) as HTMLTextAreaElement;

        if (questionInput) {
            questionInput.value = existingQuestion || "";
            this.adjustTextareaHeight(questionInput);
        }

        if (contextInput && existingQuestionData?.context) {
            contextInput.value = existingQuestionData.context;
            this.adjustTextareaHeight(contextInput);
        }
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
     * Clear form inputs
     */
    private clearForm(): void {
        if (!this.element) return;

        const questionInput = this.element.querySelector(
            ".question-input",
        ) as HTMLTextAreaElement;
        const contextInput = this.element.querySelector(
            ".context-input",
        ) as HTMLTextAreaElement;

        if (questionInput) questionInput.value = "";
        if (contextInput) contextInput.value = "";
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

        // Submit button
        const submitButton = this.element.querySelector(".submit-button");
        submitButton?.addEventListener("click", () => this.handleSubmit());

        // Example questions
        const exampleButtons =
            this.element.querySelectorAll(".example-question");
        exampleButtons.forEach((button) => {
            button.addEventListener("click", this.handleExampleClick);
        });

        // Backdrop click to close
        const backdrop = this.element.querySelector(
            ".question-dialog-backdrop",
        );
        backdrop?.addEventListener("click", () => this.hide());

        // Prevent modal content clicks from closing
        const container = this.element.querySelector(
            ".question-dialog-container",
        );
        container?.addEventListener("click", (e) => e.stopPropagation());

        // Keyboard shortcuts
        document.addEventListener("keydown", this.handleKeyDown);

        // Auto-resize textareas
        const textareas = this.element.querySelectorAll("textarea");
        textareas.forEach((textarea) => {
            textarea.addEventListener("input", this.handleTextareaInput);
        });
    }

    /**
     * Handle example question click
     */
    private handleExampleClick = (event: Event): void => {
        const button = event.target as HTMLElement;
        const question = button.getAttribute("data-question");

        if (question) {
            const questionInput = this.element?.querySelector(
                ".question-input",
            ) as HTMLTextAreaElement;
            if (questionInput) {
                questionInput.value = question;
                questionInput.focus();
                this.adjustTextareaHeight(questionInput);
            }
        }
    };

    /**
     * Handle textarea input for auto-resize
     */
    private handleTextareaInput = (event: Event): void => {
        const textarea = event.target as HTMLTextAreaElement;
        this.adjustTextareaHeight(textarea);
    };

    /**
     * Adjust textarea height based on content
     */
    private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    }

    /**
     * Handle submit action
     */
    private handleSubmit = (): void => {
        if (
            (!this.currentSelection && !this.currentScreenshot) ||
            !this.callback
        )
            return;

        const questionInput = this.element?.querySelector(
            ".question-input",
        ) as HTMLTextAreaElement;
        const contextInput = this.element?.querySelector(
            ".context-input",
        ) as HTMLTextAreaElement;

        if (!questionInput) return;

        const question = questionInput.value.trim();
        if (!question) {
            this.showError("Please enter a question.");
            questionInput.focus();
            return;
        }

        const context = contextInput?.value.trim();

        const questionData: QuestionData = {
            question,
            selectedText: this.currentSelection?.text,
            screenshotData: this.currentScreenshot || undefined,
            context: context || undefined,
            blockquoteContent: this.currentSelection?.text, // Store blockquote content separately
        };

        try {
            this.callback(questionData);
            this.hide();
        } catch (error) {
            console.error("Error submitting question:", error);
            this.showError("Failed to submit question. Please try again.");
        }
    };

    /**
     * Show error message
     */
    private showError(message: string): void {
        // Remove existing error
        const existingError = this.element?.querySelector(
            ".question-dialog-error",
        );
        if (existingError) {
            existingError.remove();
        }

        // Create new error message
        const errorDiv = document.createElement("div");
        errorDiv.className = "question-dialog-error";
        errorDiv.textContent = message;

        const footer = this.element?.querySelector(".question-dialog-footer");
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

        // Ctrl+Enter or Cmd+Enter to submit
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            this.handleSubmit();
        }
    };

    /**
     * Clean up and remove dialog
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
