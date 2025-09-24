// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type EditorCodeActions =
    | EditorActionCreateFunction
    | EditorActionCreateCodeBlock
    | EditorActionFixProblem
    | EditorActionInsertComment
    | EditorActionGenerateWithCopilot
    | EditorActionCreateFile
    | EditorActionSaveCurrentFile
    | EditorActionSaveAllFiles;

// Action to create a new file in the editor
export type EditorActionCreateFile = {
    actionName: "createFile";
    parameters: {
        fileName?: string; // "utils.ts"
        // Name of the folder to create the file in (e.g., "src")
        folderName?: string;
        // Optional: restrict to folders under this path or name
        folderRelativeTo?: string;
        language?: string; // "typescript", "python", "csharp", "javascript" etc.
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
    | { type: "onLine"; line: number }
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

// Do not fill the fileName unless the user explicitly specified it.
export type FileTarget = {
    // Name of the file to create or open or edit (e.g., "utils.ts")
    fileName?: string;
    // Name of the folder to the file is contained in (e.g., "src")
    folderName?: string;
    // Optional: restrict to folders under this path or name
    folderRelativeTo?: string;
    // Optional: if file doesn't exist, should it be created?, default: false
    createIfNotExists?: boolean;
    // Optional: fallback to currently active file if not open, default: true
    fallbackToActiveFile?: boolean;
};

// Schema to generate a function
export type EditorActionCreateFunction = {
    actionName: "createFunction";
    parameters: {
        // Programming language of the function (determines syntax rules and formatting)
        language: "typescript" | "python" | "javascript" | string;
        // The full function declaration or signature line (e.g., "function foo(x: number): number {")
        // This must include the opening brace (for JS/TS) or colon (for Python) and match the language's syntax
        functionDeclaration: string;
        // Function implementation body (excluding the closing brace or dedent, if applicable)
        // This should contain valid code that performs the intended task.
        // If left as an empty string (""), the extension will attempt to trigger GitHub Copilot to complete the body.
        // Prefer generating this value if the function behavior is well understood.
        body?: string;
        // A one-line docstring or comment that explains what the function does.
        // This should describe the function’s intent based on the declaration and user request.
        // Used to improve readability and may help tools like Copilot complete the function more accurately.
        docstring?: string;
        // Optional: the name of the function. If omitted, may be inferred from the declaration.
        name?: string;
        // Optional: an array of function parameters with their names and types (for display or analysis)
        args?: ArgumentDefinition[];
        // Optional: the function's return type (e.g., "string", "void", "Promise<boolean>")
        returnType?: string;
        // Optional: whether the function should be marked as async
        isAsync?: boolean;
        // Optional: the target file where the function should be inserted
        file?: FileTarget;
        // Optional: where in the file to insert the function. Defaults to current cursor location if not provided.
        position?: CursorTarget;
    };
};

export type EditorActionCreateCodeBlock = {
    actionName: "createCodeBlock";
    parameters: {
        language: string;
        // A short natural language prompt or description of what the code block should do.
        // Used for generating context-aware completions (e.g., via Copilot).
        // Example: "Loop over x in descending order"
        docstring?: string;
        // The starting line of a structured code block, such as a for-loop, if-statement, etc.
        // Example: "for (let i = 0; i < arr.length; i++) {"
        declaration?: string;
        // Optional body of the code block, excluding the closing brace.
        // Can be omitted if Copilot or the agent will generate it.
        body?: string;
        // A short or one-liner code expression to insert directly or use as a Copilot prompt.
        // Example: "const total = prices.reduce(...)"
        // If provided, takes precedence over declaration/body.
        codeSnippet?: string;
        // True if the request is partial or uncertain (e.g., from speech).
        // Used to guide how much the agent or Copilot should infer.
        isPartial?: boolean;
        // Optional target file where the code should be inserted.
        // Only emit the file if specified by the user.
        // If omitted, defaults to the active editor.
        file?: FileTarget;
        // Position in the file where the code block should be inserted.
        // Defaults to { type: "atCursor" }.
        position?: CursorTarget;
    };
};

export type ProblemTarget =
    | { type: "first" }
    | { type: "next" }
    | { type: "cursor"; position: CursorTarget }
    | { type: "indexInFile"; index: number; file?: FileTarget };


// schema to fix a problem (diagnostic) in the code.
// The target can be the first problem, the next one, all, or a specific location/index in the file.
// Optional hints from the user (e.g. "fix the second error") or file scoping may guide the choice.
// Used when the user requests: "fix this problem", "fix the second error", "fix all issues in this file".
export type EditorActionFixProblem = {
    actionName: "fixCodeProblem";
    parameters: {
        // Which problem to fix (e.g., "first", "next", "atCursor", or "second problem in file")
        target: ProblemTarget;
        // Optional context hint from the agent (parsed from user request)
        hint?: string;
        // File scope (defaults to active editor)
        file?: FileTarget;
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

export type EditorActionSaveCurrentFile = {
    actionName: "saveCurrentFile";
    parameters: {
        showErrorIfNoActiveEditor?: boolean;
        onlyDirty?: boolean;
        excludeUntitled?: boolean;
    };
};

export type EditorActionSaveAllFiles = {
    actionName: "saveAllFiles";
    parameters: {
        onlyDirty?: boolean;
        excludeUntitled?: boolean;
        logResult?: boolean;
    };
};
