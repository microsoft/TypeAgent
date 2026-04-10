// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type {
    GrammarJson,
    Grammar,
    CompiledSpacingMode,
} from "./grammarTypes.js";
export { grammarFromJson } from "./grammarDeserializer.js";
export { grammarToJson } from "./grammarSerializer.js";
export { loadGrammarRules, loadGrammarRulesNoThrow } from "./grammarLoader.js";
export type { LoadGrammarRulesOptions } from "./grammarLoader.js";
export type { SchemaLoader } from "./grammarCompiler.js";

// Parser (for tooling — formatter, linters, etc.)
export { parseGrammarRules } from "./grammarRuleParser.js";
export type {
    GrammarParseResult,
    ImportStatement,
    RuleDefinition,
    SpacingAnnotationComments,
} from "./grammarRuleParser.js";

// Writer / formatter
export { writeGrammarRules } from "./grammarRuleWriter.js";

export { matchGrammar, GrammarMatchResult } from "./grammarMatcher.js";
export { needsSeparatorInAutoMode } from "./grammarMatcher.js";

export {
    matchGrammarCompletion,
    GrammarCompletionResult,
    spacingModeToSeparatorMode,
} from "./grammarCompletion.js";
export type {
    AfterWildcard,
    GrammarCompletionGroup,
    GrammarCompletionProperty,
} from "./grammarCompletion.js";

// Entity system
export type { EntityValidator, EntityConverter } from "./entityRegistry.js";
export {
    EntityRegistry,
    globalEntityRegistry,
    createValidator,
    createConverter,
} from "./entityRegistry.js";
export {
    Ordinal,
    Cardinal,
    CalendarDate,
    CalendarDateValue,
    CalendarTime,
    CalendarTimeValue,
    CalendarTimeRange,
    CalendarTimeRangeValue,
    CalendarDayRange,
    CalendarDayRangeValue,
    registerBuiltInEntities,
} from "./builtInEntities.js";

export type { BuiltInGrammarCategory } from "./builtInGrammarCategories.js";
export {
    BUILT_IN_GRAMMAR_CATEGORIES,
    getBuiltInCategory,
    getBuiltInCategoryNames,
    getBuiltInCategoryDescriptions,
    getReferencedCategories,
} from "./builtInGrammarCategories.js";

export type { PhraseSetMatcher } from "./builtInPhraseMatchers.js";
export { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";

// Dynamic loading
export type { DynamicLoadResult } from "./dynamicGrammarLoader.js";
export {
    DynamicGrammarLoader,
    DynamicGrammarCache,
} from "./dynamicGrammarLoader.js";

// NFA system
export type {
    NFA,
    NFAState,
    NFATransition,
    AcceptStatePriorityHint,
} from "./nfa.js";
export {
    matchNFA,
    sortNFAMatches,
    buildFirstTokenIndex,
    matchNFAWithIndex,
    type NFAMatchResult,
    type NFAExecutionState,
    type FirstTokenIndex,
} from "./nfaInterpreter.js";
export { compileGrammarToNFA, normalizeGrammar } from "./nfaCompiler.js";
export { enrichGrammarWithCheckedVariables } from "./grammarMetadata.js";

// Environment-based slot system
export type {
    Environment,
    SlotMap,
    SlotAssignment,
    SlotValue,
    ValueExpression,
    VariableRef,
    LiteralValue,
    ArrayExpression,
    ObjectExpression,
    ActionExpression,
} from "./environment.js";
export {
    createEnvironment,
    getSlotValue,
    setSlotValue,
    writeToParent,
    evaluateExpression,
    parseValueExpression,
    compileValueExpression,
    createSlotMap,
    cloneEnvironment,
} from "./environment.js";

// NFA-based grammar matching
export {
    matchGrammarWithNFA,
    tokenizeRequest,
    normalizeToken,
    type NFAGrammarMatchResult,
} from "./nfaMatcher.js";
export { computeNFACompletions } from "./nfaCompletion.js";

// DFA system
export type {
    DFA,
    DFAState,
    DFAExecutionContext,
    DFATransition,
    DFAWildcardTransition,
    DFAPhraseSetTransition,
    MatchAST,
    MatchNode,
    TokenMatchNode,
    WildcardMatchNode,
    PhraseSetMatchNode,
    RuleRefMatchNode,
} from "./dfa.js";
export { DFABuilder } from "./dfa.js";
export { compileNFAToDFA } from "./dfaCompiler.js";
export {
    matchDFA,
    matchDFAWithSplitting,
    matchDFAToAST,
    matchDFAToASTWithSplitting,
    evaluateMatchAST,
    getDFACompletions,
    printDFA,
    type DFAMatchResult,
    type DFAASTMatchResult,
    type DFACompletionResult,
    type DFACompletionGroup,
    type DFAPropertyCompletion,
    type WildcardCompletionInfo,
} from "./dfaMatcher.js";
export { splitToken, applySplitToTokens } from "./tokenSplit.js";
export {
    DFACompilationManager,
    globalDFACompilationManager,
    type DFACompilationInfo,
    type DFACompilationStatus,
} from "./dfaCompilationManager.js";

// Agent Grammar Registry
export type { AgentMatchResult } from "./agentGrammarRegistry.js";
export {
    AgentGrammar,
    AgentGrammarRegistry,
    globalAgentGrammarRegistry,
} from "./agentGrammarRegistry.js";

// Grammar Store (dynamic rule persistence)
export type {
    StoredGrammarRule,
    GrammarStoreData,
    GrammarStoreInfo,
} from "./grammarStore.js";
export {
    GrammarStore,
    getSessionGrammarDirPath,
    getSessionGrammarStorePath,
} from "./grammarStore.js";
