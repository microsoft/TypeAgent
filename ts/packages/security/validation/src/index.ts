// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// index.ts - Export barrel for validation package (SDK-free symbols only)
// ═══════════════════════════════════════════════════════════════════════════

// Schema types — excludes ValidationResult/ValidationError/ValidationErrorType
// which collide with planValidator exports. The spec versions describe the DSL's
// own validation schema; the planValidator versions are the ones used in practice.
export type {
    AgentPlan,
    PlanImport,
    ParameterDefinition,
    BindingType,
    BindingDeclaration,
    PlanNode,
    PlanStep,
    IfNode,
    ForEachNode,
    WhileNode,
    ParallelNode,
    TransactionNode,
    CallNode,
    Tool,
    InputSpec,
    InputConstraint,
    Effect,
    DiffSpec,
    LineSpec,
    ASTTransform,
    ErrorHandler,
    Predicate,
    FilePredicate,
    ContentPredicate,
    ComparisonPredicate,
    StatePredicate,
    SemanticPredicate,
    CompareOp,
    PathExpr,
    ValueExpr,
    PlanLimits,
    PlanBudget,
    PlanPermissions,
    ResourceLock,
    ConflictCheck,
    CacheConfig,
    MetricDefinition,
    PlanEvents,
    EventHandler,
    OutputSchema,
    JSONSchema,
    PlanMetadata,
    ChangelogEntry,
    ExecutionOptions,
    ExecutionTrace,
    TraceEntry,
} from "./specSchema.js";

// Validator functions and types
export {
    validatePlan,
    checkCircularDependencies,
    flattenPlan,
    createStepIndex,
    getExecutionOrder,
    checkInputConstraints,
    matchConstraint,
} from "./planValidator.js";

export type {
    ValidationResult,
    ValidationError,
    ValidationWarning,
    ValidationPhase,
    ConstraintMatchResult,
} from "./planValidator.js";

// Prompt utilities
export {
    buildPlanningPrompt,
    PLANNING_USER_PROMPT,
    AGENT_PLAN_JSON_SCHEMA,
} from "./prompts/planPrompt.js";

// Predicate evaluator
export {
    evaluatePostconditions,
    evaluatePredicate,
    resolvePath,
    checkPlanPermission,
} from "./predicateEvaluator.js";

export type {
    EvalContext,
    PredicateResult,
    PostconditionResult,
    PermissionCheckResult,
} from "./predicateEvaluator.js";

// Organization policy
export {
    loadOrgPolicy,
    validatePlanAgainstPolicy,
    checkToolCallAgainstPolicy,
    checkPathAgainstPolicy,
    checkBashAgainstPolicy,
    parseBashCommand,
    deriveContainerVolumes,
    buildDockerArgs,
    checkDockerAvailability,
} from "./orgPolicy.js";

export type {
    OrgPolicy,
    PathPolicy,
    BashPolicy,
    NetworkPolicy,
    ContainerPolicy,
    DevicePolicy,
    DerivedVolume,
    PolicyViolation,
    PolicyViolationRule,
    PolicyValidationResult,
    CommandSegment,
    ParsedCommand,
} from "./orgPolicy.js";
