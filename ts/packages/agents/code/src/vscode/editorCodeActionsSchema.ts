// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type EditorCodeActions =
    | EditorActionCreateFunction
    | EditorActionInsertComment
    | EditorActionGenerateWithCopilot
    | EditorActionRepairWithCopilot
    | EditorActionCreateFile;

// Action to create a new file in the editor
export type EditorActionCreateFile = {
    actionName: "createFile";
    parameters: {
        fileName?: string; // "utils.ts"
        filePath?: string; // "src/helpers"
        language?: string; // "typescript", "python", etc.
        untitled?: boolean; // true → don't save to disk
        openInEditor?: boolean; // default: true
        content?: string; // actual content to write to the file
        overwriteIfExists?: boolean; // default: false
        focusExistingIfOpen?: boolean; // default: true
    };
};

export type ArgumentDefinition = {
    // The name of the argument/parameter
    name: string;
    // The type annotation (e.g., "number[]", "str", or undefined for JS)
    type?: string;
    // Optional default value if applicable
    defaultValue?: string;
};

export type CursorTarget =
    | { type: "atCursor" }
    | { type: "insideFunction"; name: string }
    | { type: "afterLine"; line: number }
    | { type: "beforeLine"; line: number }
    | { type: "inSelection" }
    | { type: "atStartOfFile" }
    | { type: "atEndOfFile" }
    | { type: "insideClass"; name: string }
    | { type: "insideBlockComment"; containingText?: string }
    | { type: "inFile"; filePath: string; fallback?: CursorTarget }; // Optional fallback if file is not open

export type CodeTarget =
    | { type: "cursor" }
    | { type: "selection" }
    | { type: "function"; name?: string }
    | { type: "line"; lineNumber: number }
    | { type: "range"; start: number; end: number };

export type EditorActionCreateFunction = {
    actionName: "createFunction";
    parameters: {
        // The name of the function to create
        name: string;
        // Programming language for the function
        language: "typescript" | "python" | "javascript" | string;
        // Function arguments/parameters
        args?: ArgumentDefinition[];
        // Return type annotation (optional, especially for TS)
        returnType?: string;
        // Where to insert the function
        position?: CursorTarget;
        // Optional Python-style docstring
        docstring?: string;
        // Optional: support for async functions
        isAsync?: boolean;
    };
};

export type EditorActionInsertComment = {
    actionName: "insertComment";
    parameters: {
        // The comment content, excluding the comment syntax itself
        text: string;
        // Optional, helps format comments (e.g., // vs #)
        language?: string;
        // Comment style (default: "line")
        commentStyle?: "line" | "block";
        // Where to insert the comment
        position: CursorTarget;
        // Whether to add a blank line before the comment
        newlineBefore?: boolean;
        // Whether to add a blank line after the comment
        newlineAfter?: boolean;
    };
};

export type CopilotGenerationStrategy =
    | "inlineCompletion" // cursor-based generation (default VSCode experience)
    | "commentToCode" // insert a comment, then trigger Copilot
    | "generateFix" // use selection + prompt to suggest a fix
    | "generateInsideFunction" // complete body inside a known function
    | "suggestAlternatives"; // generate multiple variants, agent may choose one

export type CopilotContextInjection = {
    // The role of this context injection
    role: "prefix" | "suffix" | "file" | "doc" | "comment";
    // The content to inject
    content: string;
    // Optional language hint for the content
    language?: string;
};

export type EditorActionGenerateWithCopilot = {
    actionName: "generateWithCopilot";
    parameters: {
        // The generation strategy to use
        strategy: CopilotGenerationStrategy;
        // Where to generate the code
        position: CursorTarget;
        // Optional language hint
        language?: string;
        // Optional: natural language guidance (if not using inline)
        prompt?: string;
        // Optional: provide surrounding code or references
        context?: CopilotContextInjection[];
        // Optional: how many suggestions to try (default: 1)
        attemptLimit?: number;
        // Optional: whether to auto-accept Copilot's first suggestion
        autoAccept?: boolean;
        // Optional: let agent explain what Copilot might generate
        explanationMode?: boolean;
    };
};

export type CopilotRepairStrategy =
    | "selection" // Fix the selected code
    | "insideFunction" // Fix the function body
    | "byDiagnostic" // Based on diagnostics (e.g., from TypeScript or Python)
    | "byPrompt" // Based on user prompt, even without diagnostics
    | "fileWide"; // Attempt to repair entire file (advanced use)

export type EditorActionRepairWithCopilot = {
    actionName: "repairWithCopilot";
    parameters: {
        // The repair strategy to use
        strategy: CopilotRepairStrategy;
        // Where to apply the repair
        position: CursorTarget;
        // Optional language hint
        language?: string;
        // Optional: LSP or textual diagnostics to guide the fix
        diagnostics?: string[];
        // Optional: user prompt to guide the repair (e.g., "Fix the null check", "Add error handling", etc.)
        prompt?: string;
        // Optional: whether to auto-accept the first Copilot suggestion
        autoAccept?: boolean;
        // Optional: whether to explain the repair process
        explanationMode?: boolean;
        // Optional: how many attempts to make or variants to generate (Default is 1, but can be increased for more complex repairs)
        attemptLimit?: number;
    };
};

export type CompositeActionPlanCodeInsertion = {
    actionName: "planCodeInsertion";
    parameters: {
        // Programming language (e.g., "typescript", "python")
        language: string;
        // High-level natural language request from the user
        description: string;
        // Ordered list of atomic actions to execute
        plan: EditorCodeActions[];
        // If true, agent should verbalize or display plan before executing
        explainPlan?: boolean;
    };
};

export type EditorActionCopilotShowEditActions = {
    actionName: "copilotShowEditActions";
    parameters: {
        // Where to show edit actions
        position: CursorTarget;
        // Scope of the edit actions (optional)
        scope?: "selection" | "function" | "line" | "file";
        // Optional language hint
        language?: string;
        // Optional filter text (e.g., "refactor", "fix", "simplify")
        filterByText?: string;
        // How to choose from available actions
        chooseBy?: "auto" | "name" | "index" | "interactive";
        // Action name to match (used if chooseBy is "name")
        nameMatch?: string;
        // Index of action to select (used if chooseBy is "index")
        index?: number;
        // Apply immediately if matched
        autoApply?: boolean;
        // Let the agent narrate what it's about to apply
        explanationMode?: boolean;
    };
};

export type EditorActionApplyCodeAction = {
    actionName: "applyCodeAction";
    parameters: {
        // The source of the code action
        source: "copilot" | "languageServer" | string;
        // Where to trigger the code actions
        position: CursorTarget;
        // Scope of the code action (optional)
        scope?: "selection" | "function" | "line" | "file";
        // Strategy to choose action
        chooseBy?: "auto" | "index" | "title" | "interactive";
        // Action title to match (used if chooseBy is "title")
        titleMatch?: string;
        // Index of action to select (used if chooseBy is "index")
        index?: number;
        // Show edit diff before applying
        showDiffPreview?: boolean;
        // Ask user or agent to confirm before applying
        confirmBeforeApply?: boolean;
        // Save the file after change
        saveAfterApply?: boolean;
        // Allow reverting this change
        allowUndo?: boolean;
    };
};

export type EditorActionUndoLastEdit = {
    actionName: "undoLastEdit";
    parameters: {
        reason?: string;
        scope?: "file" | "workspace";
        // how many edits to undo (default 1)
        count?: number;
    };
};
