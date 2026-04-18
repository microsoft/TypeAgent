// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    AppAgentManifest,
    ActionManifest,
    GrammarContent,
    GrammarFormat,
    SchemaContent,
    SchemaFormat,
    SchemaManifest,
    AppAgent,
    AppAgentEvent,
    SessionContext,
    StorageListOptions,
    Storage,
    StorageEncoding,
    TokenCachePersistence,
    ActionContext,
    SchemaTypeNames,
    ActivityContext,
    AppAgentInitSettings,
    ResolveEntityResult,
    ActivityCacheSpec,
} from "./agentInterface.js";

export {
    CommandDescriptor,
    CommandDescriptors,
    CommandDescriptorTable,
    AppAgentCommandInterface,
    CompletionDirection,
    CompletionGroup,
    CompletionGroups,
    SeparatorMode,
    AfterWildcard,
} from "./command.js";

export {
    ObjectValue,
    FlagValueTypes,
    ParameterDefinitions,
    ParsedCommandParams,
    PartialParsedCommandParams,
    ArgDefinitions,
    FlagDefinitions,
} from "./parameters.js";
export {
    ActionIO,
    ClientAction,
    DisplayType,
    DynamicDisplay,
    MessageContent,
    DisplayContent,
    TypedDisplayContent,
    DisplayAppendMode,
    DisplayMessageKind,
} from "./display.js";

export {
    AppAction,
    TypeAgentAction,
    ActionResultError,
    ActionResultSuccessNoDisplay,
    ActionResultSuccess,
    ActionResult,
    ActionResultActivityContext,
    PendingChoice,
    PendingYesNoChoice,
    PendingMultiChoice,
} from "./action.js";

export type {
    TemplateFieldPrimitive,
    TemplateFieldStringUnion,
    TemplateFieldScalar,
    TemplateFieldArray,
    TemplateFieldObject,
    TemplateField,
    TemplateType,
    TemplateSchema,
} from "./templateInput.js";

export { Entity, EntityFacet, EntityFacetValue } from "./memory.js";
