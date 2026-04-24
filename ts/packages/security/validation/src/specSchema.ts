// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// specSchema.ts - Complete logical syntax for agent plan specification v1.1
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// PLAN STRUCTURE
// ───────────────────────────────────────────────────────────────────────────

export interface AgentPlan {
    /** Schema version for forward compatibility */
    version: "1.1";

    /** Unique identifier for this plan */
    id: string;

    /** Human-readable goal description */
    goal: string;

    /** Plan imports (composition) */
    imports?: PlanImport[];

    /** Plan parameters (for templates) */
    parameters?: ParameterDefinition[];

    /** Declared bindings with types */
    bindings?: BindingDeclaration[];

    /** Preconditions that must be true before execution */
    preconditions?: Predicate[];

    /** Must remain true throughout execution */
    invariants?: Predicate[];

    /** Ordered steps to execute (v1: linear PlanStep only) */
    steps: PlanStep[];

    /** Postconditions that must be true after execution */
    postconditions?: Predicate[];

    /** Run regardless of success/failure */
    cleanup?: PlanStep[];

    /** Pause for human approval at these steps */
    checkpoints?: number[];

    /** Resource limits */
    limits: PlanLimits;

    /** Cost/budget constraints */
    budget?: PlanBudget;

    /** Security permissions */
    permissions: PlanPermissions;

    /** Resource locking */
    locks?: ResourceLock;

    /** Conflict detection */
    conflicts?: ConflictCheck;

    /** Event handlers */
    events?: PlanEvents;

    /** Expected final output */
    outputSchema?: OutputSchema;

    /** Inline comments */
    comments?: Record<string, string>;

    /** Changelog */
    changelog?: ChangelogEntry[];

    /** Metadata */
    metadata: PlanMetadata;
}

// ───────────────────────────────────────────────────────────────────────────
// COMPOSITION & REUSE
// ───────────────────────────────────────────────────────────────────────────

export interface PlanImport {
    /** Import name */
    name: string;

    /** Path or plan ID */
    from: string;

    /** Alias */
    as?: string;
}

export interface ParameterDefinition {
    /** Parameter name */
    name: string;

    /** Parameter type */
    type: BindingType;

    /** Is required */
    required: boolean;

    /** Default value */
    default?: unknown;

    /** Description */
    description?: string;

    /** Validation predicate */
    validate?: Predicate;
}

// ───────────────────────────────────────────────────────────────────────────
// BINDINGS & TYPES
// ───────────────────────────────────────────────────────────────────────────

export type BindingType =
    | { kind: "primitive"; type: "string" | "number" | "boolean" }
    | { kind: "array"; elementType: BindingType }
    | { kind: "file_content" }
    | { kind: "file_list" }
    | { kind: "match_result" }
    | { kind: "record"; fields: Record<string, BindingType> }
    | { kind: "any" };

export interface BindingDeclaration {
    /** Binding name */
    name: string;

    /** Binding type */
    type: BindingType;

    /** Step index that produces this binding */
    producedBy: number;

    /** Description */
    description?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// PLAN NODES (Steps + Control Flow)
// ───────────────────────────────────────────────────────────────────────────

export type PlanNode =
    | PlanStep
    | IfNode
    | ForEachNode
    | WhileNode
    | ParallelNode
    | TransactionNode
    | CallNode;

// Basic step
export interface PlanStep {
    nodeType: "step";

    /** Step index (0-based, unique across all nodes) */
    index: number;

    /** Tool to invoke */
    tool: Tool;

    /** Human-readable description */
    description: string;

    /** Constraints on the tool input */
    inputSpec: InputSpec;

    /** Steps that must complete before this one */
    dependsOn: number[];

    /** What this step produces */
    effect: Effect;

    /** Error handling */
    onError: ErrorHandler;

    /** Rollback steps if this fails */
    rollback?: PlanStep[];

    /** Step-level limits */
    timeoutMs?: number;
    maxOutputSize?: number;

    /** Caching configuration */
    cache?: CacheConfig;

    /** Tags for filtering and grouping */
    tags?: string[];

    /** Custom metrics to collect */
    metrics?: MetricDefinition[];

    /** Log level for this step */
    logLevel?: "debug" | "info" | "warn" | "error";

    /** Custom log message */
    logMessage?: string;

    /** Human-readable rationale */
    rationale?: string;

    /** Links to related docs */
    references?: string[];

    /** Known issues or caveats */
    caveats?: string[];
}

// Conditional
export interface IfNode {
    nodeType: "if";
    index: number;
    condition: Predicate;
    then: PlanNode[];
    else?: PlanNode[];
}

// Loop over collection
export interface ForEachNode {
    nodeType: "forEach";
    index: number;
    bind: string;
    bindIndex?: string;
    in: ValueExpr;
    steps: PlanNode[];
}

// Conditional loop
export interface WhileNode {
    nodeType: "while";
    index: number;
    condition: Predicate;
    steps: PlanNode[];
    maxIterations: number;
}

// Concurrent execution
export interface ParallelNode {
    nodeType: "parallel";
    index: number;
    branches: PlanNode[][];
    joinCondition: "all" | "any" | "allSettled";
}

// Atomic group
export interface TransactionNode {
    nodeType: "transaction";
    index: number;
    name: string;
    steps: PlanNode[];
    rollback: PlanStep[];
}

// Sub-plan invocation
export interface CallNode {
    nodeType: "call";
    index: number;
    planId: string;
    arguments: Record<string, ValueExpr>;
    bind?: string;
}

// TODO should make this into an extensibility point so it just reads all
// the tools in an environment
export type Tool =
    | "Glob" // Find files by pattern
    | "Read" // Read file contents
    | "Write" // Create/overwrite files
    | "Edit" // Make targeted edits to files
    | "Grep" // Search file contents with regex
    | "Bash" // Execute shell commands (may be restricted by policy)
    | "Npm" // Package manager (npm/pnpm) — structured, no shell injection
    | "Git" // Version control — structured, no shell injection
    | "Node" // Run a Node.js script file — structured, no shell injection
    | "Tsc" // TypeScript compilation — structured, no shell injection
    | "Task" // Launch subagents for complex tasks
    | "WebFetch" // Fetch and process web content
    | "WebSearch" // Search the web
    | "NotebookEdit" // Edit Jupyter notebook cells
    | "TodoWrite" // Manage task lists
    | "AskUserQuestion"; // Ask user for input/clarification

// ───────────────────────────────────────────────────────────────────────────
// INPUT SPECIFICATION
// ───────────────────────────────────────────────────────────────────────────

export type InputSpec = {
    [key: string]: InputConstraint;
};

export type InputConstraint =
    // Value constraints
    | { type: "exact"; value: unknown }
    | { type: "any" }

    // String constraints
    | { type: "contains"; substring: string }
    | { type: "notContains"; substring: string }
    | { type: "regex"; pattern: string; flags?: string }
    | { type: "startsWith"; prefix: string }
    | { type: "endsWith"; suffix: string }
    | { type: "length"; op: CompareOp; value: number }

    // Choice constraints
    | { type: "oneOf"; values: unknown[] }
    | { type: "noneOf"; values: unknown[] }

    // Type constraints
    | {
          type: "isType";
          expectedType: "string" | "number" | "boolean" | "array" | "object";
      }

    // Reference constraints
    | { type: "ref"; stepIndex: number; outputPath: string }
    | { type: "var"; name: string }

    // Compound constraints
    | { type: "and"; constraints: InputConstraint[] }
    | { type: "or"; constraints: InputConstraint[] }
    | { type: "not"; constraint: InputConstraint };

// ───────────────────────────────────────────────────────────────────────────
// EFFECTS
// ───────────────────────────────────────────────────────────────────────────

export type Effect =
    | { type: "none" }
    | { type: "produces"; bind: string; valueType: BindingType }
    | { type: "modifies_file"; path: PathExpr }
    | { type: "creates_file"; path: PathExpr }
    | { type: "deletes_file"; path: PathExpr }
    | { type: "multiple"; effects: Effect[] };

// ───────────────────────────────────────────────────────────────────────────
// DIFF SPECIFICATION
// ───────────────────────────────────────────────────────────────────────────

export type DiffSpec =
    | { type: "unified_diff"; diff: string }
    | { type: "line_changes"; additions: LineSpec[]; deletions: LineSpec[] }
    | { type: "ast_transform"; language: string; transform: ASTTransform };

export interface LineSpec {
    lineNumber?: number;
    after?: string;
    before?: string;
    content: string;
}

export interface ASTTransform {
    type:
        | "add_import"
        | "rename_function"
        | "add_parameter"
        | "wrap_expression";
    target: string;
    value: unknown;
}

// ───────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ───────────────────────────────────────────────────────────────────────────

export type ErrorHandler =
    | { action: "abort"; message?: string }
    | {
          action: "retry";
          maxAttempts: number;
          delayMs: number;
          backoff?: "linear" | "exponential";
      }
    | { action: "skip"; continueWith?: number }
    | { action: "fallback"; steps: PlanNode[] }
    | { action: "ignore" };

// ───────────────────────────────────────────────────────────────────────────
// PREDICATES
// ───────────────────────────────────────────────────────────────────────────

export type Predicate =
    // Atomic predicates
    | FilePredicate
    | ContentPredicate
    | ComparisonPredicate
    | StatePredicate
    | SemanticPredicate

    // Logical combinators
    | { type: "and"; predicates: Predicate[] }
    | { type: "or"; predicates: Predicate[] }
    | { type: "not"; predicate: Predicate }
    | { type: "implies"; if: Predicate; then: Predicate }
    | { type: "iff"; left: Predicate; right: Predicate }

    // Quantifiers
    | { type: "forAll"; bind: string; in: ValueExpr; predicate: Predicate }
    | { type: "exists"; bind: string; in: ValueExpr; predicate: Predicate }
    | { type: "unique"; bind: string; in: ValueExpr; predicate: Predicate }

    // Temporal
    | { type: "before"; stepIndex: number; predicate: Predicate }
    | { type: "after"; stepIndex: number; predicate: Predicate }
    | { type: "always"; predicate: Predicate }
    | { type: "eventually"; predicate: Predicate }

    // Meta
    | { type: "true" }
    | { type: "false" };

// File predicates
export type FilePredicate =
    | { type: "file_exists"; path: PathExpr }
    | { type: "file_not_exists"; path: PathExpr }
    | { type: "is_file"; path: PathExpr }
    | { type: "is_directory"; path: PathExpr }
    | { type: "is_empty_file"; path: PathExpr }
    | { type: "is_readable"; path: PathExpr }
    | { type: "is_writable"; path: PathExpr }
    | { type: "file_size"; path: PathExpr; op: CompareOp; bytes: number };

// Content predicates
export type ContentPredicate =
    | {
          type: "file_contains";
          path: PathExpr;
          text: string;
          caseSensitive?: boolean;
      }
    | { type: "file_not_contains"; path: PathExpr; text: string }
    | { type: "file_matches"; path: PathExpr; regex: string; flags?: string }
    | {
          type: "file_has_line";
          path: PathExpr;
          line: string;
          lineNumber?: number;
      }
    | {
          type: "file_has_lines";
          path: PathExpr;
          lines: string[];
          ordered: boolean;
          contiguous?: boolean;
      }
    | { type: "line_count"; path: PathExpr; op: CompareOp; value: number }
    | { type: "file_starts_with"; path: PathExpr; text: string }
    | { type: "file_ends_with"; path: PathExpr; text: string };

// Comparison predicates
export type ComparisonPredicate =
    | { type: "equals"; left: ValueExpr; right: ValueExpr }
    | { type: "not_equals"; left: ValueExpr; right: ValueExpr }
    | { type: "greater_than"; left: ValueExpr; right: ValueExpr }
    | { type: "greater_than_or_equal"; left: ValueExpr; right: ValueExpr }
    | { type: "less_than"; left: ValueExpr; right: ValueExpr }
    | { type: "less_than_or_equal"; left: ValueExpr; right: ValueExpr }
    | {
          type: "in_range";
          value: ValueExpr;
          min: ValueExpr;
          max: ValueExpr;
          inclusive?: boolean;
      };

// State predicates
export type StatePredicate =
    | { type: "changed"; path: PathExpr }
    | { type: "unchanged"; path: PathExpr }
    | { type: "created_during_execution"; path: PathExpr }
    | { type: "deleted_during_execution"; path: PathExpr }
    | { type: "binding_defined"; name: string }
    | { type: "step_completed"; stepIndex: number }
    | { type: "step_failed"; stepIndex: number };

// Semantic predicates (code-aware)
export type SemanticPredicate =
    // Function-level
    | { type: "function_exists"; file: PathExpr; name: string }
    | {
          type: "function_has_params";
          file: PathExpr;
          name: string;
          count: number;
      }
    | {
          type: "function_returns_type";
          file: PathExpr;
          name: string;
          returnType: string;
      }

    // Class-level
    | { type: "class_exists"; file: PathExpr; name: string }
    | { type: "class_extends"; file: PathExpr; name: string; parent: string }
    | {
          type: "class_has_method";
          file: PathExpr;
          className: string;
          methodName: string;
      }

    // Import-level
    | { type: "imports"; file: PathExpr; module: string }
    | { type: "exports"; file: PathExpr; name: string }

    // Syntax-level
    | { type: "valid_syntax"; file: PathExpr; language: string }
    | { type: "no_lint_errors"; file: PathExpr; config?: string };

export type CompareOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

// ───────────────────────────────────────────────────────────────────────────
// EXPRESSIONS
// ───────────────────────────────────────────────────────────────────────────

export type PathExpr =
    | { type: "literal"; value: string }
    | { type: "var"; name: string }
    | { type: "join"; separator?: string; parts: PathExpr[] }
    | { type: "parent"; path: PathExpr }
    | { type: "basename"; path: PathExpr }
    | { type: "extension"; path: PathExpr }
    | { type: "stepOutput"; stepIndex: number; field: string }
    | { type: "template"; template: string; vars: Record<string, ValueExpr> };

export type ValueExpr =
    // Literals
    | { type: "literal"; value: unknown }
    | { type: "null" }

    // References
    | { type: "var"; name: string }
    | { type: "stepOutput"; stepIndex: number; field: string }
    | { type: "env"; name: string }

    // File operations
    | { type: "fileContent"; path: PathExpr }
    | { type: "lineCount"; path: PathExpr }
    | { type: "fileSize"; path: PathExpr }

    // String operations
    | { type: "concat"; values: ValueExpr[] }
    | { type: "substring"; value: ValueExpr; start: number; end?: number }
    | {
          type: "replace";
          value: ValueExpr;
          search: string;
          replace: string;
          all?: boolean;
      }
    | { type: "trim"; value: ValueExpr }
    | { type: "lower"; value: ValueExpr }
    | { type: "upper"; value: ValueExpr }
    | { type: "split"; value: ValueExpr; delimiter: string }

    // Array operations
    | { type: "length"; of: ValueExpr }
    | { type: "index"; array: ValueExpr; index: number }
    | { type: "first"; array: ValueExpr }
    | { type: "last"; array: ValueExpr }
    | { type: "slice"; array: ValueExpr; start: number; end?: number }
    | { type: "filter"; array: ValueExpr; bind: string; predicate: Predicate }
    | { type: "map"; array: ValueExpr; bind: string; transform: ValueExpr }
    | { type: "flatten"; array: ValueExpr }
    | { type: "unique"; array: ValueExpr }

    // Numeric operations
    | { type: "add"; left: ValueExpr; right: ValueExpr }
    | { type: "subtract"; left: ValueExpr; right: ValueExpr }
    | { type: "multiply"; left: ValueExpr; right: ValueExpr }
    | { type: "divide"; left: ValueExpr; right: ValueExpr }
    | { type: "modulo"; left: ValueExpr; right: ValueExpr }
    | { type: "abs"; value: ValueExpr }
    | { type: "min"; values: ValueExpr[] }
    | { type: "max"; values: ValueExpr[] }

    // Conditional
    | { type: "if"; condition: Predicate; then: ValueExpr; else: ValueExpr }

    // Object operations
    | { type: "property"; object: ValueExpr; path: string }
    | { type: "keys"; object: ValueExpr }
    | { type: "values"; object: ValueExpr };

// ───────────────────────────────────────────────────────────────────────────
// LIMITS & CONSTRAINTS
// ───────────────────────────────────────────────────────────────────────────

export interface PlanLimits {
    maxTotalSteps: number;
    maxDurationMs: number;
    maxFileWrites: number;
    maxBytesWritten: number;
    maxBytesRead: number;
    maxNestingDepth: number;
    maxParallelBranches: number;
}

export interface PlanBudget {
    maxTokens?: number;
    maxCostUsd?: number;
    onExceeded: "warn" | "pause" | "abort";
}

// ───────────────────────────────────────────────────────────────────────────
// SECURITY & PERMISSIONS
// ───────────────────────────────────────────────────────────────────────────

export interface PlanPermissions {
    allowedReadPaths: string[];
    allowedWritePaths: string[];
    deniedPaths: string[];
    requiredApprovers?: string[];
    requiredSecrets?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// RESOURCE LOCKING & CONFLICTS
// ───────────────────────────────────────────────────────────────────────────

export interface ResourceLock {
    lockedPaths: PathExpr[];
    mode: "exclusive" | "shared";
    onConflict: "wait" | "fail" | "force";
    waitTimeoutMs?: number;
}

export interface ConflictCheck {
    conflictsWith?: string[];
    dependsOnPlans?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// CACHING
// ───────────────────────────────────────────────────────────────────────────

export interface CacheConfig {
    enabled: boolean;
    key: ValueExpr;
    ttlMs?: number;
    invalidateOn?: Predicate;
}

// ───────────────────────────────────────────────────────────────────────────
// OBSERVABILITY
// ───────────────────────────────────────────────────────────────────────────

export interface MetricDefinition {
    name: string;
    type: "counter" | "gauge" | "histogram";
    value: ValueExpr;
    labels?: Record<string, string>;
}

export interface PlanEvents {
    onStepStart?: EventHandler;
    onStepComplete?: EventHandler;
    onStepFail?: EventHandler;
    onCheckpoint?: EventHandler;
    onComplete?: EventHandler;
}

export type EventHandler = {
    notify: "webhook" | "log" | "callback";
    target: string;
    payload?: Record<string, ValueExpr>;
};

// ───────────────────────────────────────────────────────────────────────────
// OUTPUT SCHEMA
// ───────────────────────────────────────────────────────────────────────────

export type OutputSchema =
    | { type: "files_modified"; paths: PathExpr[] }
    | { type: "files_created"; paths: PathExpr[] }
    | { type: "binding"; name: string; expectedType: BindingType }
    | { type: "value"; schema: JSONSchema }
    | { type: "composite"; outputs: OutputSchema[] };

export interface JSONSchema {
    type: "string" | "number" | "boolean" | "array" | "object" | "null";
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema;
    required?: string[];
    enum?: unknown[];
}

// ───────────────────────────────────────────────────────────────────────────
// METADATA & DOCUMENTATION
// ───────────────────────────────────────────────────────────────────────────

export interface PlanMetadata {
    createdAt: number;
    author?: string;
    description?: string;
    tags?: string[];
    estimatedDurationMs?: number;
    estimatedSteps?: number;
    allowedTools: Tool[];
}

export interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// EXECUTION OPTIONS
// ───────────────────────────────────────────────────────────────────────────

export interface ExecutionOptions {
    dryRun: boolean;
    previewChanges: boolean;
    resumeFrom?: number;
    skipSteps?: number[];
    initialBindings?: Record<string, unknown>;
    environment: "development" | "staging" | "production";
}

// ───────────────────────────────────────────────────────────────────────────
// VALIDATION RESULTS
// ───────────────────────────────────────────────────────────────────────────

export type ValidationResult =
    | { status: "valid" }
    | { status: "invalid"; errors: ValidationError[] };

export interface ValidationError {
    stepIndex?: number;
    nodeType?: string;
    errorType: ValidationErrorType;
    message: string;
    predicate?: Predicate;
    expected?: unknown;
    actual?: unknown;
}

export type ValidationErrorType =
    | "precondition_failed"
    | "postcondition_failed"
    | "invariant_violated"
    | "step_deviation"
    | "input_constraint_violated"
    | "type_mismatch"
    | "limit_exceeded"
    | "timeout"
    | "binding_undefined"
    | "dependency_not_met"
    | "tool_not_allowed"
    | "permission_denied"
    | "conflict_detected"
    | "budget_exceeded";

// ───────────────────────────────────────────────────────────────────────────
// EXECUTION TRACE (for ledger)
// ───────────────────────────────────────────────────────────────────────────

export interface ExecutionTrace {
    planId: string;
    planVersion: string;
    startedAt: number;
    completedAt?: number;
    status: "running" | "completed" | "failed" | "aborted" | "paused";
    entries: TraceEntry[];
    finalBindings: Record<string, unknown>;
    metrics: Record<string, number>;
}

export interface TraceEntry {
    index: number;
    timestamp: number;
    previousHash: string;
    hash: string;
    stepIndex: number;
    nodeType: string;
    tool?: Tool;
    input: Record<string, unknown>;
    output?: unknown;
    durationMs: number;
    status: "success" | "failed" | "skipped" | "cached";
    error?: string;
    cached?: boolean;
}
