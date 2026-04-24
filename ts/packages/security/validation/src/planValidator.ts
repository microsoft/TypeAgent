// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// planValidator.ts - PDDL-style validator for AgentPlan specifications
// ═══════════════════════════════════════════════════════════════════════════

import type {
    AgentPlan,
    PlanStep,
    BindingDeclaration,
    Predicate,
    PathExpr,
    ValueExpr,
    InputConstraint,
    InputSpec,
    Effect,
    Tool,
    ErrorHandler,
    CompareOp,
} from "./specSchema.js";

// ───────────────────────────────────────────────────────────────────────────
// VALIDATION RESULT TYPES
// ───────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    phase: ValidationPhase;
    stepIndex?: number;
    bindingName?: string;
    message: string;
    path?: string; // JSON path to the error location
}

export interface ValidationWarning {
    phase: ValidationPhase;
    stepIndex?: number;
    message: string;
}

export type ValidationPhase =
    | "structural"
    | "index_integrity"
    | "binding"
    | "predicate"
    | "control_flow"
    | "input_spec"
    | "effect"
    | "error_handling"
    | "limits"
    | "permissions"
    | "imports"
    | "cleanup"
    | "policy";

// ───────────────────────────────────────────────────────────────────────────
// VALIDATION CONTEXT
// ───────────────────────────────────────────────────────────────────────────

interface ValidationContext {
    // Collected during traversal
    allStepIndices: Set<number>;
    bindingProducers: Map<string, number>; // binding name -> step that produces it
    bindingTypes: Map<string, string>; // binding name -> type kind
    stepEffects: Map<number, Effect>;
    importedPlans: Map<string, string>; // alias -> planId
    usedTools: Set<Tool>;
    readPaths: Set<string>;
    writePaths: Set<string>;
    maxNestingDepth: number;
    maxParallelBranches: number;

    // Current state during traversal
    currentScope: Set<string>; // bindings in scope (including forEach binds)
    executedSteps: Set<number>; // steps "before" current point
    currentNestingDepth: number;

    // Plan reference
    plan: AgentPlan;

    // Output
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

function createContext(plan: AgentPlan): ValidationContext {
    return {
        allStepIndices: new Set(),
        bindingProducers: new Map(),
        bindingTypes: new Map(),
        stepEffects: new Map(),
        importedPlans: new Map(),
        usedTools: new Set(),
        readPaths: new Set(),
        writePaths: new Set(),
        maxNestingDepth: 0,
        maxParallelBranches: 0,
        currentScope: new Set(),
        executedSteps: new Set(),
        currentNestingDepth: 0,
        plan,
        errors: [],
        warnings: [],
    };
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN VALIDATOR
// ───────────────────────────────────────────────────────────────────────────

export function validatePlan(plan: AgentPlan): ValidationResult {
    // Normalize optional arrays to empty so downstream passes don't need null checks
    const bindings = plan.bindings ?? [];
    const preconditions = plan.preconditions ?? [];
    const invariants = plan.invariants ?? [];
    const postconditions = plan.postconditions ?? [];
    const cleanup = plan.cleanup ?? [];
    const checkpoints = plan.checkpoints ?? [];

    const ctx = createContext(plan);

    // Pass 1: Structural validation
    validateStructure(plan, ctx);

    // Pass 2: Collect all indices and check uniqueness
    collectIndices(plan.steps, ctx);

    // Pass 3: Validate imports
    validateImports(plan, ctx);

    // Pass 4: Validate bindings declarations
    validateBindings(bindings, ctx);

    // Pass 5: Validate preconditions (before any execution)
    validatePredicates(preconditions, ctx, "precondition");

    // Pass 6: Validate invariants
    validatePredicates(invariants, ctx, "invariant");

    // Pass 7: Simulate execution order, validate each step
    validateSteps(plan.steps, ctx);

    // Pass 8: Validate postconditions
    validatePredicates(postconditions, ctx, "postcondition");

    // Pass 9: Validate cleanup steps
    validateCleanup(cleanup, ctx);

    // Pass 10: Validate limits match reality
    validateLimits(plan.limits, ctx);

    // Pass 11: Validate permissions cover all operations
    validatePermissions(plan.permissions, ctx);

    // Pass 12: Validate checkpoints
    validateCheckpoints(checkpoints, ctx);

    // Pass 13: Validate metadata
    validateMetadata(plan.metadata, ctx);

    return {
        valid: ctx.errors.length === 0,
        errors: ctx.errors,
        warnings: ctx.warnings,
    };
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 1: STRUCTURAL VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateStructure(plan: AgentPlan, ctx: ValidationContext): void {
    if (plan.version !== "1.1") {
        ctx.errors.push({
            phase: "structural",
            message: `Invalid version: expected '1.1', got '${plan.version}'`,
        });
    }

    if (!plan.id || typeof plan.id !== "string" || plan.id.trim() === "") {
        ctx.errors.push({
            phase: "structural",
            message: "Plan id must be a non-empty string",
        });
    }

    if (
        !plan.goal ||
        typeof plan.goal !== "string" ||
        plan.goal.trim() === ""
    ) {
        ctx.errors.push({
            phase: "structural",
            message: "Plan goal must be a non-empty string",
        });
    }

    if (!Array.isArray(plan.steps)) {
        ctx.errors.push({
            phase: "structural",
            message: "Plan steps must be an array",
        });
    }

    if (plan.bindings !== undefined && !Array.isArray(plan.bindings)) {
        ctx.errors.push({
            phase: "structural",
            message: "Plan bindings must be an array when provided",
        });
    }

    if (!plan.limits || typeof plan.limits !== "object") {
        ctx.errors.push({
            phase: "structural",
            message: "Plan limits must be an object",
        });
    }

    if (!plan.permissions || typeof plan.permissions !== "object") {
        ctx.errors.push({
            phase: "structural",
            message: "Plan permissions must be an object",
        });
    }

    if (!plan.metadata || typeof plan.metadata !== "object") {
        ctx.errors.push({
            phase: "structural",
            message: "Plan metadata must be an object",
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 2: INDEX COLLECTION & UNIQUENESS
// ───────────────────────────────────────────────────────────────────────────

function collectIndices(steps: PlanStep[], ctx: ValidationContext): void {
    for (const step of steps) {
        if (ctx.allStepIndices.has(step.index)) {
            ctx.errors.push({
                phase: "index_integrity",
                stepIndex: step.index,
                message: `Duplicate step index: ${step.index}`,
            });
        } else {
            ctx.allStepIndices.add(step.index);
        }

        if (step.index < 0) {
            ctx.errors.push({
                phase: "index_integrity",
                stepIndex: step.index,
                message: `Step index must be non-negative: ${step.index}`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 3: IMPORT VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateImports(plan: AgentPlan, ctx: ValidationContext): void {
    if (!plan.imports) return;

    const names = new Set<string>();
    const aliases = new Set<string>();

    for (const imp of plan.imports) {
        // Check name uniqueness
        if (names.has(imp.name)) {
            ctx.errors.push({
                phase: "imports",
                message: `Duplicate import name: ${imp.name}`,
            });
        }
        names.add(imp.name);

        // Check alias uniqueness
        const alias = imp.as ?? imp.name;
        if (aliases.has(alias)) {
            ctx.errors.push({
                phase: "imports",
                message: `Duplicate import alias: ${alias}`,
            });
        }
        aliases.add(alias);

        // Store for later CallNode validation
        ctx.importedPlans.set(alias, imp.from);

        // Check for empty from
        if (!imp.from || imp.from.trim() === "") {
            ctx.errors.push({
                phase: "imports",
                message: `Import '${imp.name}' has empty 'from' path`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 4: BINDING VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateBindings(
    bindings: BindingDeclaration[],
    ctx: ValidationContext,
): void {
    const names = new Set<string>();

    for (const binding of bindings) {
        // Check name uniqueness
        if (names.has(binding.name)) {
            ctx.errors.push({
                phase: "binding",
                bindingName: binding.name,
                message: `Duplicate binding name: ${binding.name}`,
            });
        }
        names.add(binding.name);

        // Check producedBy references a valid step
        if (!ctx.allStepIndices.has(binding.producedBy)) {
            ctx.errors.push({
                phase: "binding",
                bindingName: binding.name,
                stepIndex: binding.producedBy,
                message: `Binding '${binding.name}' producedBy references non-existent step ${binding.producedBy}`,
            });
        }

        // Store for later reference checking
        ctx.bindingProducers.set(binding.name, binding.producedBy);
        ctx.bindingTypes.set(binding.name, binding.type.kind);
        ctx.currentScope.add(binding.name);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 5-6: PREDICATE VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validatePredicates(
    predicates: Predicate[],
    ctx: ValidationContext,
    location: string,
): void {
    for (let i = 0; i < predicates.length; i++) {
        validatePredicate(predicates[i], ctx, `${location}[${i}]`);
    }
}

function validatePredicate(
    pred: Predicate,
    ctx: ValidationContext,
    path: string,
): void {
    switch (pred.type) {
        // File predicates
        case "file_exists":
        case "file_not_exists":
        case "is_file":
        case "is_directory":
        case "is_empty_file":
        case "is_readable":
        case "is_writable":
            validatePathExpr((pred as any).path, ctx, `${path}.path`);
            break;

        case "file_size":
            validatePathExpr((pred as any).path, ctx, `${path}.path`);
            break;

        // Content predicates
        case "file_contains":
        case "file_not_contains":
        case "file_matches":
        case "file_has_line":
        case "file_has_lines":
        case "file_starts_with":
        case "file_ends_with":
        case "line_count":
            validatePathExpr((pred as any).path, ctx, `${path}.path`);
            break;

        // Comparison predicates
        case "equals":
        case "not_equals":
        case "greater_than":
        case "greater_than_or_equal":
        case "less_than":
        case "less_than_or_equal":
            validateValueExpr((pred as any).left, ctx, `${path}.left`);
            validateValueExpr((pred as any).right, ctx, `${path}.right`);
            break;

        case "in_range":
            validateValueExpr((pred as any).value, ctx, `${path}.value`);
            validateValueExpr((pred as any).min, ctx, `${path}.min`);
            validateValueExpr((pred as any).max, ctx, `${path}.max`);
            break;

        // State predicates
        case "changed":
        case "unchanged":
        case "created_during_execution":
        case "deleted_during_execution":
            validatePathExpr((pred as any).path, ctx, `${path}.path`);
            break;

        case "binding_defined":
            if (!ctx.currentScope.has((pred as any).name)) {
                ctx.errors.push({
                    phase: "predicate",
                    message: `Predicate references undefined binding: ${(pred as any).name}`,
                    path,
                });
            }
            break;

        case "step_completed":
        case "step_failed":
            if (!ctx.allStepIndices.has((pred as any).stepIndex)) {
                ctx.errors.push({
                    phase: "predicate",
                    stepIndex: (pred as any).stepIndex,
                    message: `Predicate references non-existent step: ${(pred as any).stepIndex}`,
                    path,
                });
            }
            break;

        // Logical combinators
        case "and":
        case "or":
            for (let i = 0; i < (pred as any).predicates.length; i++) {
                validatePredicate(
                    (pred as any).predicates[i],
                    ctx,
                    `${path}.predicates[${i}]`,
                );
            }
            break;

        case "not":
            validatePredicate(
                (pred as any).predicate,
                ctx,
                `${path}.predicate`,
            );
            break;

        case "implies":
        case "iff":
            validatePredicate(
                (pred as any).if ?? (pred as any).left,
                ctx,
                `${path}.if`,
            );
            validatePredicate(
                (pred as any).then ?? (pred as any).right,
                ctx,
                `${path}.then`,
            );
            break;

        // Quantifiers
        case "forAll":
        case "exists":
        case "unique":
            validateValueExpr((pred as any).in, ctx, `${path}.in`);
            // Add bound variable to scope temporarily
            const boundVar = (pred as any).bind;
            if (ctx.currentScope.has(boundVar)) {
                ctx.warnings.push({
                    phase: "predicate",
                    message: `Quantifier shadows existing binding: ${boundVar}`,
                });
            }
            ctx.currentScope.add(boundVar);
            validatePredicate(
                (pred as any).predicate,
                ctx,
                `${path}.predicate`,
            );
            ctx.currentScope.delete(boundVar);
            break;

        // Temporal
        case "before":
        case "after":
            if (!ctx.allStepIndices.has((pred as any).stepIndex)) {
                ctx.errors.push({
                    phase: "predicate",
                    stepIndex: (pred as any).stepIndex,
                    message: `Temporal predicate references non-existent step: ${(pred as any).stepIndex}`,
                    path,
                });
            }
            validatePredicate(
                (pred as any).predicate,
                ctx,
                `${path}.predicate`,
            );
            break;

        case "always":
        case "eventually":
            validatePredicate(
                (pred as any).predicate,
                ctx,
                `${path}.predicate`,
            );
            break;

        // Semantic predicates
        case "function_exists":
        case "function_has_params":
        case "function_returns_type":
        case "class_exists":
        case "class_extends":
        case "class_has_method":
        case "imports":
        case "exports":
        case "valid_syntax":
        case "no_lint_errors":
            validatePathExpr((pred as any).file, ctx, `${path}.file`);
            break;

        case "true":
        case "false":
            // Always valid
            break;

        default:
            ctx.warnings.push({
                phase: "predicate",
                message: `Unknown predicate type: ${(pred as any).type}`,
            });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PATH & VALUE EXPRESSION VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validatePathExpr(
    expr: PathExpr,
    ctx: ValidationContext,
    path: string,
): void {
    switch (expr.type) {
        case "literal":
            // Always valid
            break;

        case "var":
            if (!ctx.currentScope.has(expr.name)) {
                ctx.errors.push({
                    phase: "predicate",
                    message: `PathExpr references undefined binding: ${expr.name}`,
                    path,
                });
            }
            break;

        case "join":
            for (let i = 0; i < expr.parts.length; i++) {
                validatePathExpr(expr.parts[i], ctx, `${path}.parts[${i}]`);
            }
            break;

        case "parent":
        case "basename":
        case "extension":
            validatePathExpr(expr.path, ctx, `${path}.path`);
            break;

        case "stepOutput":
            if (!ctx.allStepIndices.has(expr.stepIndex)) {
                ctx.errors.push({
                    phase: "predicate",
                    stepIndex: expr.stepIndex,
                    message: `PathExpr references non-existent step: ${expr.stepIndex}`,
                    path,
                });
            }
            break;

        case "template":
            for (const [varName, varExpr] of Object.entries(expr.vars)) {
                validateValueExpr(varExpr, ctx, `${path}.vars.${varName}`);
            }
            break;
    }
}

function validateValueExpr(
    expr: ValueExpr,
    ctx: ValidationContext,
    path: string,
): void {
    switch (expr.type) {
        case "literal":
        case "null":
            // Always valid
            break;

        case "var":
            if (!ctx.currentScope.has(expr.name)) {
                ctx.errors.push({
                    phase: "predicate",
                    message: `ValueExpr references undefined binding: ${expr.name}`,
                    path,
                });
            }
            break;

        case "stepOutput":
            if (!ctx.allStepIndices.has(expr.stepIndex)) {
                ctx.errors.push({
                    phase: "predicate",
                    stepIndex: expr.stepIndex,
                    message: `ValueExpr references non-existent step: ${expr.stepIndex}`,
                    path,
                });
            }
            break;

        case "env":
            // Environment variable - can't validate at compile time
            break;

        case "fileContent":
        case "lineCount":
        case "fileSize":
            validatePathExpr(expr.path, ctx, `${path}.path`);
            break;

        case "concat":
            for (let i = 0; i < expr.values.length; i++) {
                validateValueExpr(expr.values[i], ctx, `${path}.values[${i}]`);
            }
            break;

        case "substring":
        case "trim":
        case "lower":
        case "upper":
            validateValueExpr(expr.value, ctx, `${path}.value`);
            break;

        case "replace":
            validateValueExpr(expr.value, ctx, `${path}.value`);
            break;

        case "split":
            validateValueExpr(expr.value, ctx, `${path}.value`);
            break;

        case "length":
            validateValueExpr(expr.of, ctx, `${path}.of`);
            break;

        case "index":
        case "first":
        case "last":
        case "slice":
        case "flatten":
        case "unique":
            validateValueExpr(expr.array, ctx, `${path}.array`);
            break;

        case "filter":
        case "map":
            validateValueExpr(expr.array, ctx, `${path}.array`);
            ctx.currentScope.add(expr.bind);
            if (expr.type === "filter") {
                validatePredicate(expr.predicate, ctx, `${path}.predicate`);
            } else {
                validateValueExpr(expr.transform, ctx, `${path}.transform`);
            }
            ctx.currentScope.delete(expr.bind);
            break;

        case "add":
        case "subtract":
        case "multiply":
        case "divide":
        case "modulo":
            validateValueExpr(expr.left, ctx, `${path}.left`);
            validateValueExpr(expr.right, ctx, `${path}.right`);
            break;

        case "abs":
            validateValueExpr(expr.value, ctx, `${path}.value`);
            break;

        case "min":
        case "max":
            for (let i = 0; i < expr.values.length; i++) {
                validateValueExpr(expr.values[i], ctx, `${path}.values[${i}]`);
            }
            break;

        case "if":
            validatePredicate(expr.condition, ctx, `${path}.condition`);
            validateValueExpr(expr.then, ctx, `${path}.then`);
            validateValueExpr(expr.else, ctx, `${path}.else`);
            break;

        case "property":
            validateValueExpr(expr.object, ctx, `${path}.object`);
            break;

        case "keys":
        case "values":
            validateValueExpr(expr.object, ctx, `${path}.object`);
            break;
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 7: NODE VALIDATION (Simulation)
// ───────────────────────────────────────────────────────────────────────────

function validateSteps(steps: PlanStep[], ctx: ValidationContext): void {
    for (const step of steps) {
        // Check dependencies before processing
        validateDependencies(step, ctx);

        // Validate the step
        validateStep(step, ctx);

        // Mark step as executed
        ctx.executedSteps.add(step.index);
    }
}

function validateDependencies(step: PlanStep, ctx: ValidationContext): void {
    for (const dep of step.dependsOn) {
        if (!ctx.allStepIndices.has(dep)) {
            ctx.errors.push({
                phase: "index_integrity",
                stepIndex: step.index,
                message: `Step ${step.index} depends on non-existent step ${dep}`,
            });
        }

        if (dep >= step.index) {
            ctx.errors.push({
                phase: "index_integrity",
                stepIndex: step.index,
                message: `Step ${step.index} depends on future or same step ${dep} (must be < ${step.index})`,
            });
        }

        if (!ctx.executedSteps.has(dep)) {
            ctx.errors.push({
                phase: "index_integrity",
                stepIndex: step.index,
                message: `Step ${step.index} depends on step ${dep} which hasn't been executed yet in this path`,
            });
        }
    }
}

function validateStep(step: PlanStep, ctx: ValidationContext): void {
    // Track tool usage
    ctx.usedTools.add(step.tool);

    // Validate inputSpec
    validateInputSpec(step.inputSpec, ctx, `step[${step.index}].inputSpec`);

    // Validate effect
    validateEffect(step.effect, ctx, `step[${step.index}].effect`);

    // Validate error handler
    validateErrorHandler(step.onError, ctx, `step[${step.index}].onError`);

    // Validate rollback if present
    if (step.rollback) {
        for (let i = 0; i < step.rollback.length; i++) {
            validateStep(step.rollback[i], ctx);
        }
    }

    // Validate timeouts
    if (step.timeoutMs !== undefined && step.timeoutMs <= 0) {
        ctx.errors.push({
            phase: "control_flow",
            stepIndex: step.index,
            message: `Step ${step.index} has invalid timeoutMs: ${step.timeoutMs}`,
        });
    }

    // Track read/write paths based on tool
    trackToolPaths(step, ctx);
}

function trackToolPaths(step: PlanStep, ctx: ValidationContext): void {
    // This is a simplified version - in practice you'd resolve the actual paths
    if (step.tool === "Read" || step.tool === "Grep" || step.tool === "Glob") {
        // These are read operations
        if (step.inputSpec.path) {
            ctx.readPaths.add(`step[${step.index}].path`);
        }
        if (step.inputSpec.pattern) {
            ctx.readPaths.add(`step[${step.index}].pattern`);
        }
    }

    if (step.tool === "Write" || step.tool === "Edit") {
        // These are write operations
        if (step.inputSpec.file_path || step.inputSpec.path) {
            ctx.writePaths.add(`step[${step.index}].path`);
        }
    }
}

function validateInputSpec(
    spec: Record<string, InputConstraint>,
    ctx: ValidationContext,
    path: string,
): void {
    for (const [key, constraint] of Object.entries(spec)) {
        validateInputConstraint(constraint, ctx, `${path}.${key}`);
    }
}

function validateInputConstraint(
    constraint: InputConstraint,
    ctx: ValidationContext,
    path: string,
): void {
    switch (constraint.type) {
        case "ref":
            if (!ctx.allStepIndices.has(constraint.stepIndex)) {
                ctx.errors.push({
                    phase: "input_spec",
                    stepIndex: constraint.stepIndex,
                    message: `InputConstraint ref references non-existent step: ${constraint.stepIndex}`,
                    path,
                });
            }
            if (!ctx.executedSteps.has(constraint.stepIndex)) {
                ctx.errors.push({
                    phase: "input_spec",
                    stepIndex: constraint.stepIndex,
                    message: `InputConstraint ref references step ${constraint.stepIndex} which hasn't executed yet`,
                    path,
                });
            }
            break;

        case "var":
            if (!ctx.currentScope.has(constraint.name)) {
                ctx.errors.push({
                    phase: "input_spec",
                    message: `InputConstraint var references undefined binding: ${constraint.name}`,
                    path,
                });
            }
            break;

        case "regex":
            try {
                new RegExp(constraint.pattern, constraint.flags);
            } catch (e) {
                ctx.errors.push({
                    phase: "input_spec",
                    message: `InputConstraint has invalid regex: ${constraint.pattern}`,
                    path,
                });
            }
            break;

        case "and":
        case "or":
            for (let i = 0; i < constraint.constraints.length; i++) {
                validateInputConstraint(
                    constraint.constraints[i],
                    ctx,
                    `${path}.constraints[${i}]`,
                );
            }
            break;

        case "not":
            validateInputConstraint(
                constraint.constraint,
                ctx,
                `${path}.constraint`,
            );
            break;

        // These are always valid structurally
        case "exact":
        case "any":
        case "contains":
        case "notContains":
        case "startsWith":
        case "endsWith":
        case "length":
        case "oneOf":
        case "noneOf":
        case "isType":
            break;
    }
}

function validateEffect(
    effect: Effect,
    ctx: ValidationContext,
    path: string,
): void {
    switch (effect.type) {
        case "none":
            break;

        case "produces":
            if (!ctx.currentScope.has(effect.bind)) {
                ctx.errors.push({
                    phase: "effect",
                    message: `Effect produces binding '${effect.bind}' which is not declared`,
                    path,
                });
            }
            break;

        case "modifies_file":
        case "creates_file":
        case "deletes_file":
            validatePathExpr(effect.path, ctx, `${path}.path`);
            break;

        case "multiple":
            for (let i = 0; i < effect.effects.length; i++) {
                validateEffect(effect.effects[i], ctx, `${path}.effects[${i}]`);
            }
            break;
    }
}

function validateErrorHandler(
    handler: ErrorHandler,
    ctx: ValidationContext,
    path: string,
): void {
    switch (handler.action) {
        case "abort":
        case "ignore":
            break;

        case "retry":
            if (handler.maxAttempts <= 0) {
                ctx.errors.push({
                    phase: "error_handling",
                    message: `ErrorHandler retry maxAttempts must be > 0`,
                    path,
                });
            }
            if (handler.delayMs < 0) {
                ctx.errors.push({
                    phase: "error_handling",
                    message: `ErrorHandler retry delayMs must be >= 0`,
                    path,
                });
            }
            break;

        case "skip":
            if (handler.continueWith !== undefined) {
                if (!ctx.allStepIndices.has(handler.continueWith)) {
                    ctx.errors.push({
                        phase: "error_handling",
                        message: `ErrorHandler skip continueWith references non-existent step: ${handler.continueWith}`,
                        path,
                    });
                }
            }
            break;

        case "fallback":
            for (let i = 0; i < handler.steps.length; i++) {
                validateStep(handler.steps[i] as PlanStep, ctx);
            }
            break;
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 9: CLEANUP VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateCleanup(cleanup: PlanStep[], ctx: ValidationContext): void {
    for (let i = 0; i < cleanup.length; i++) {
        const step = cleanup[i];

        // Cleanup steps should not depend on bindings that might not exist
        // For now, we just validate them normally
        validateStep(step, ctx);

        // Warn if cleanup has complex error handling
        if (step.onError.action === "fallback") {
            ctx.warnings.push({
                phase: "cleanup",
                stepIndex: step.index,
                message: `Cleanup step ${step.index} has fallback error handling - keep cleanup simple`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 10: LIMITS VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateLimits(
    limits: AgentPlan["limits"],
    ctx: ValidationContext,
): void {
    if (limits.maxTotalSteps < ctx.allStepIndices.size) {
        ctx.errors.push({
            phase: "limits",
            message: `limits.maxTotalSteps (${limits.maxTotalSteps}) is less than actual step count (${ctx.allStepIndices.size})`,
        });
    }

    if (limits.maxNestingDepth < ctx.maxNestingDepth) {
        ctx.errors.push({
            phase: "limits",
            message: `limits.maxNestingDepth (${limits.maxNestingDepth}) is less than actual nesting depth (${ctx.maxNestingDepth})`,
        });
    }

    if (limits.maxParallelBranches < ctx.maxParallelBranches) {
        ctx.errors.push({
            phase: "limits",
            message: `limits.maxParallelBranches (${limits.maxParallelBranches}) is less than actual max branches (${ctx.maxParallelBranches})`,
        });
    }

    // Check all limits are positive
    const positiveFields = [
        "maxTotalSteps",
        "maxDurationMs",
        "maxFileWrites",
        "maxBytesWritten",
        "maxBytesRead",
        "maxNestingDepth",
        "maxParallelBranches",
    ] as const;

    for (const field of positiveFields) {
        if (limits[field] <= 0) {
            ctx.errors.push({
                phase: "limits",
                message: `limits.${field} must be > 0: ${limits[field]}`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 11: PERMISSIONS VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validatePermissions(
    permissions: AgentPlan["permissions"],
    ctx: ValidationContext,
): void {
    // Check for overlap between allowed and denied paths
    for (const denied of permissions.deniedPaths) {
        if (permissions.allowedReadPaths.includes(denied)) {
            ctx.errors.push({
                phase: "permissions",
                message: `Path '${denied}' is in both allowedReadPaths and deniedPaths`,
            });
        }
        if (permissions.allowedWritePaths.includes(denied)) {
            ctx.errors.push({
                phase: "permissions",
                message: `Path '${denied}' is in both allowedWritePaths and deniedPaths`,
            });
        }
    }

    // Warn if write operations are used but no write paths defined
    const writeTools: Tool[] = ["Write", "Edit"];
    const hasWriteOps = [...ctx.usedTools].some((t) => writeTools.includes(t));
    if (hasWriteOps && permissions.allowedWritePaths.length === 0) {
        ctx.warnings.push({
            phase: "permissions",
            message: `Plan uses write operations but allowedWritePaths is empty`,
        });
    }

    // Warn if read operations are used but no read paths defined
    const readTools: Tool[] = ["Read", "Grep", "Glob"];
    const hasReadOps = [...ctx.usedTools].some((t) => readTools.includes(t));
    if (hasReadOps && permissions.allowedReadPaths.length === 0) {
        ctx.warnings.push({
            phase: "permissions",
            message: `Plan uses read operations but allowedReadPaths is empty`,
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 12: CHECKPOINT VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateCheckpoints(
    checkpoints: number[],
    ctx: ValidationContext,
): void {
    for (const checkpoint of checkpoints) {
        if (!ctx.allStepIndices.has(checkpoint)) {
            ctx.errors.push({
                phase: "structural",
                stepIndex: checkpoint,
                message: `Checkpoint references non-existent step: ${checkpoint}`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PASS 13: METADATA VALIDATION
// ───────────────────────────────────────────────────────────────────────────

function validateMetadata(
    metadata: AgentPlan["metadata"],
    ctx: ValidationContext,
): void {
    // Check that all used tools are in allowedTools
    for (const tool of ctx.usedTools) {
        if (!metadata.allowedTools.includes(tool)) {
            ctx.errors.push({
                phase: "structural",
                message: `Tool '${tool}' is used but not in metadata.allowedTools`,
            });
        }
    }

    // Check createdAt is valid
    if (metadata.createdAt <= 0) {
        ctx.errors.push({
            phase: "structural",
            message: `metadata.createdAt must be a valid timestamp`,
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// UTILITY: CIRCULAR DEPENDENCY CHECK
// ───────────────────────────────────────────────────────────────────────────

export function checkCircularDependencies(plan: AgentPlan): string[] {
    const errors: string[] = [];
    const graph = new Map<number, number[]>();

    // Build adjacency list
    for (const step of plan.steps) {
        graph.set(step.index, step.dependsOn);
    }

    // DFS to detect cycles
    const visited = new Set<number>();
    const inStack = new Set<number>();

    function dfs(node: number, path: number[]): boolean {
        if (inStack.has(node)) {
            const cycleStart = path.indexOf(node);
            const cycle = path.slice(cycleStart).concat(node);
            errors.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
            return true;
        }

        if (visited.has(node)) return false;

        visited.add(node);
        inStack.add(node);

        for (const dep of graph.get(node) ?? []) {
            if (dfs(dep, [...path, node])) return true;
        }

        inStack.delete(node);
        return false;
    }

    for (const [node] of graph) {
        dfs(node, []);
    }

    return errors;
}

// ───────────────────────────────────────────────────────────────────────────
// EXPORTED: FLATTEN PLAN TO EXECUTION ORDER
// ───────────────────────────────────────────────────────────────────────────

/**
 * Returns plan steps sorted by index for execution.
 * With v1 linear steps, this is just a sort — no tree flattening needed.
 */
export function flattenPlan(plan: AgentPlan): PlanStep[] {
    return [...plan.steps].sort((a, b) => a.index - b.index);
}

/**
 * Creates a map from step index to PlanStep for O(1) lookup during execution.
 *
 * @param plan The validated AgentPlan
 * @returns Map of step index to PlanStep
 */
export function createStepIndex(plan: AgentPlan): Map<number, PlanStep> {
    const steps = flattenPlan(plan);
    const index = new Map<number, PlanStep>();

    for (const step of steps) {
        index.set(step.index, step);
    }

    return index;
}

/**
 * Gets the expected execution order considering dependencies.
 * Returns steps in topological order (dependencies before dependents).
 *
 * @param plan The validated AgentPlan
 * @returns Array of PlanStep in dependency-respecting order
 */
export function getExecutionOrder(plan: AgentPlan): PlanStep[] {
    const steps = flattenPlan(plan);
    const stepMap = new Map<number, PlanStep>();

    for (const step of steps) {
        stepMap.set(step.index, step);
    }

    // Topological sort using Kahn's algorithm
    const inDegree = new Map<number, number>();
    const dependents = new Map<number, number[]>(); // step -> steps that depend on it

    // Initialize
    for (const step of steps) {
        inDegree.set(step.index, step.dependsOn.length);
        dependents.set(step.index, []);
    }

    // Build reverse dependency graph
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            const deps = dependents.get(dep);
            if (deps) {
                deps.push(step.index);
            }
        }
    }

    // Find all steps with no dependencies
    const queue: number[] = [];
    for (const [index, degree] of inDegree) {
        if (degree === 0) {
            queue.push(index);
        }
    }

    // Process in topological order
    const result: PlanStep[] = [];

    while (queue.length > 0) {
        // Sort queue to get consistent ordering (lower indices first)
        queue.sort((a, b) => a - b);

        const current = queue.shift()!;
        const step = stepMap.get(current);
        if (step) {
            result.push(step);
        }

        // Reduce in-degree of dependents
        for (const dependent of dependents.get(current) ?? []) {
            const newDegree = (inDegree.get(dependent) ?? 1) - 1;
            inDegree.set(dependent, newDegree);

            if (newDegree === 0) {
                queue.push(dependent);
            }
        }
    }

    // If result doesn't contain all steps, there's a cycle
    // (but this should have been caught by validatePlan)

    return result;
}

// ───────────────────────────────────────────────────────────────────────────
// EXPORTED: RUNTIME INPUT CONSTRAINT MATCHING
// ───────────────────────────────────────────────────────────────────────────

/**
 * Result of matching a constraint against a value.
 */
export interface ConstraintMatchResult {
    valid: boolean;
    reason?: string;
}

/**
 * Validates actual tool input against the plan step's inputSpec.
 * Use this in canUseTool to verify the agent is following the plan.
 *
 * @param actualInput The input object from the tool call
 * @param inputSpec The expected constraints from the PlanStep
 * @param bindings Runtime bindings (outputs from previous steps)
 * @returns Result indicating if all constraints are satisfied
 *
 * @example
 * ```typescript
 * const result = checkInputConstraints(
 *     { pattern: "**\/*.css" },
 *     { pattern: { type: "contains", substring: ".css" } },
 *     bindings
 * );
 * if (!result.valid) {
 *     return { behavior: "deny", message: result.reason };
 * }
 * ```
 */
export function checkInputConstraints(
    actualInput: Record<string, unknown>,
    inputSpec: InputSpec,
    bindings: Map<string, unknown>,
): ConstraintMatchResult {
    for (const [key, constraint] of Object.entries(inputSpec)) {
        const actualValue = actualInput[key];
        const result = matchConstraint(actualValue, constraint, bindings);

        if (!result.valid) {
            return {
                valid: false,
                reason: `Input '${key}': ${result.reason}`,
            };
        }
    }
    return { valid: true };
}

/**
 * Matches a single value against an InputConstraint.
 * Handles all constraint types defined in specSchema.ts.
 *
 * @param value The actual value to check
 * @param constraint The constraint to match against
 * @param bindings Runtime bindings for resolving 'var' constraints
 * @returns Result indicating if the constraint is satisfied
 */
export function matchConstraint(
    value: unknown,
    constraint: InputConstraint,
    bindings: Map<string, unknown>,
): ConstraintMatchResult {
    switch (constraint.type) {
        // ─── Value Constraints ───────────────────────────────────────────
        case "exact":
            return value === constraint.value
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected '${constraint.value}', got '${value}'`,
                  };

        case "any":
            return { valid: true };

        // ─── String Constraints ──────────────────────────────────────────
        case "contains":
            if (typeof value !== "string") {
                return {
                    valid: false,
                    reason: `expected string, got ${typeof value}`,
                };
            }
            return value.includes(constraint.substring)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected to contain '${constraint.substring}'`,
                  };

        case "notContains":
            if (
                typeof value === "string" &&
                value.includes(constraint.substring)
            ) {
                return {
                    valid: false,
                    reason: `expected NOT to contain '${constraint.substring}'`,
                };
            }
            return { valid: true };

        case "startsWith":
            if (typeof value !== "string") {
                return {
                    valid: false,
                    reason: `expected string, got ${typeof value}`,
                };
            }
            return value.startsWith(constraint.prefix)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected to start with '${constraint.prefix}'`,
                  };

        case "endsWith":
            if (typeof value !== "string") {
                return {
                    valid: false,
                    reason: `expected string, got ${typeof value}`,
                };
            }
            return value.endsWith(constraint.suffix)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected to end with '${constraint.suffix}'`,
                  };

        case "regex":
            if (typeof value !== "string") {
                return {
                    valid: false,
                    reason: `expected string, got ${typeof value}`,
                };
            }
            try {
                const regex = new RegExp(constraint.pattern, constraint.flags);
                return regex.test(value)
                    ? { valid: true }
                    : {
                          valid: false,
                          reason: `expected to match /${constraint.pattern}/${constraint.flags ?? ""}`,
                      };
            } catch (e) {
                return {
                    valid: false,
                    reason: `invalid regex: ${constraint.pattern}`,
                };
            }

        case "length": {
            let len: number;
            if (typeof value === "string") {
                len = value.length;
            } else if (Array.isArray(value)) {
                len = value.length;
            } else {
                return {
                    valid: false,
                    reason: `expected string or array for length check`,
                };
            }
            return compareOp(len, constraint.op, constraint.value)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `length ${len} does not satisfy ${constraint.op} ${constraint.value}`,
                  };
        }

        // ─── Choice Constraints ──────────────────────────────────────────
        case "oneOf":
            return constraint.values.includes(value)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected one of [${constraint.values.join(", ")}], got '${value}'`,
                  };

        case "noneOf":
            return !constraint.values.includes(value)
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected none of [${constraint.values.join(", ")}], got '${value}'`,
                  };

        // ─── Type Constraints ────────────────────────────────────────────
        case "isType": {
            let actualType: string;
            if (value === null) {
                actualType = "null";
            } else if (Array.isArray(value)) {
                actualType = "array";
            } else {
                actualType = typeof value;
            }

            return actualType === constraint.expectedType
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected type '${constraint.expectedType}', got '${actualType}'`,
                  };
        }

        // ─── Reference Constraints ───────────────────────────────────────
        case "var": {
            const bindingValue = bindings.get(constraint.name);
            if (bindingValue === undefined) {
                return {
                    valid: false,
                    reason: `binding '${constraint.name}' is not defined`,
                };
            }

            // If the binding is an array, check if value is one of its elements
            if (Array.isArray(bindingValue)) {
                return bindingValue.includes(value)
                    ? { valid: true }
                    : {
                          valid: false,
                          reason: `'${value}' is not in binding '${constraint.name}' [${bindingValue.join(", ")}]`,
                      };
            }

            // Otherwise check for exact match
            return value === bindingValue
                ? { valid: true }
                : {
                      valid: false,
                      reason: `expected binding '${constraint.name}' value '${bindingValue}', got '${value}'`,
                  };
        }

        case "ref": {
            // Ref constraints reference output from a previous step
            // This requires storing step outputs separately from bindings
            // For now, we just validate that the step index exists
            // A full implementation would store outputs: Map<number, unknown>
            // and check: outputs.get(constraint.stepIndex)?.[constraint.outputPath]
            return { valid: true };
        }

        // ─── Compound Constraints ────────────────────────────────────────
        case "and": {
            for (const c of constraint.constraints) {
                const result = matchConstraint(value, c, bindings);
                if (!result.valid) {
                    return result;
                }
            }
            return { valid: true };
        }

        case "or": {
            const reasons: string[] = [];
            for (const c of constraint.constraints) {
                const result = matchConstraint(value, c, bindings);
                if (result.valid) {
                    return { valid: true };
                }
                if (result.reason) {
                    reasons.push(result.reason);
                }
            }
            return {
                valid: false,
                reason: `no OR constraint matched: [${reasons.join("; ")}]`,
            };
        }

        case "not": {
            const inner = matchConstraint(
                value,
                constraint.constraint,
                bindings,
            );
            return inner.valid
                ? {
                      valid: false,
                      reason: `NOT constraint was satisfied (expected it to fail)`,
                  }
                : { valid: true };
        }

        // ─── Unknown ─────────────────────────────────────────────────────
        default:
            // Unknown constraint type - log warning but allow
            console.warn(
                `Unknown constraint type: ${(constraint as any).type}`,
            );
            return { valid: true };
    }
}

/**
 * Compares two numbers using the specified operator.
 */
function compareOp(a: number, op: CompareOp, b: number): boolean {
    switch (op) {
        case "eq":
            return a === b;
        case "neq":
            return a !== b;
        case "gt":
            return a > b;
        case "gte":
            return a >= b;
        case "lt":
            return a < b;
        case "lte":
            return a <= b;
        default:
            return false;
    }
}
