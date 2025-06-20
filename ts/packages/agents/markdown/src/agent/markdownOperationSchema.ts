// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Document operation types for incremental updates to ProseMirror documents
// Position references should be line numbers (0-based) in the document.
export type DocumentOperation =
    | InsertOperation
    | DeleteOperation
    | ReplaceOperation
    | FormatOperation;

// Insert content at a specific position
export type InsertOperation = {
    type: "insert";
    // Position in the document where content should be inserted
    position: number;
    // Content to insert. This should be provided in github-flavored markdown
    content: ContentItem[];
    // Human-readable description of what is being inserted
    description?: string;
};

// Delete content between two positions
export type DeleteOperation = {
    type: "delete";
    // Start position of content to delete
    from: number;
    // End position of content to delete
    to: number;
    // Human-readable description of what is being deleted
    description?: string;
};

// Replace content between two positions with new content
export type ReplaceOperation = {
    type: "replace";
    // Start position of content to replace
    from: number;
    // End position of content to replace
    to: number;
    // Content to insert. This should be provided in github-flavored markdown
    content: ContentItem[];
    // Human-readable description of what is being replaced
    description?: string;
};

// Apply formatting (marks) to content between two positions
export type FormatOperation = {
    type: "format";
    // Start position of content to format
    from: number;
    // End position of content to format
    to: number;
    // Formatting marks to apply or remove
    marks: MarkItem[];
    // Whether to add (true) or remove (false) the marks
    add: boolean;
    // Human-readable description of the formatting change
    description?: string;
};

// Simplified content representation that can be converted to ProseMirror nodes
export type ContentItem = {
    // Type of content node (paragraph, heading, code_block, etc.)
    type: string;
    // Text content for text nodes
    text?: string;
    // Attributes for the node (e.g., level for headings)
    attrs?: {};
    // Child content for container nodes. This should be provided in github-flavored markdown
    content?: ContentItem[];
    // Marks applied to this content (bold, italic, etc.)
    marks?: MarkItem[];
};

// Simplified mark representation
export type MarkItem = {
    // Type of mark (strong, em, code, link, etc.)
    type: string;
    // Attributes for the mark (e.g., href for links)
    attrs?: {};
};

// Result of an LLM markdown update operation
export type MarkdownUpdateResult = {
    // Brief summary of the changes made to the document
    operationSummary?: string;
    // List of operations to apply to the document
    operations: DocumentOperation[];
};
