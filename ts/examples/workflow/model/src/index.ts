// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    JSONSchema,
    SchemaTemplate,
    SchemaTemplateDefinition,
    SchemaTemplateNode,
    TypeParamRef,
    isTypeParamRef,
    Template,
    TaskNode,
    BranchArm,
    BranchNode,
    LoopStateVar,
    WorkflowScope,
    WorkflowBody,
    LoopNode,
    ForkBranch,
    ForkNode,
    ForkMapNode,
    WorkflowRef,
    WorkflowCallNode,
    WorkflowNode,
    ConstantDef,
    WorkflowIR,
} from "./ir.js";

export {
    TaskResult,
    TaskContext,
    TaskConstraints,
    TaskDefinition,
    ConcreteTaskDefinition,
    GenericTaskDefinition,
    isGenericTask,
    TaskTypeParameter,
    TaskPolicyMode,
    TaskPolicy,
    ApprovalResult,
    ApprovalFn,
} from "./taskDefinition.js";

export {
    ValidationError,
    ValidationResult,
    validateWorkflowIR,
    isNeverSchema,
    isStructuralSubtype,
    checkStructuralSubtype,
} from "./validate.js";
