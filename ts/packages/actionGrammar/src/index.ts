// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type { GrammarJson, Grammar } from "./grammarTypes.js";
export { grammarFromJson } from "./grammarDeserializer.js";
export { grammarToJson } from "./grammarSerializer.js";
export { loadGrammarRules } from "./grammarLoader.js";
export {
    matchGrammar,
    GrammarMatchResult,
    matchGrammarCompletion,
    GrammarCompletionResult,
} from "./grammarMatcher.js";

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
    registerBuiltInEntities,
} from "./builtInEntities.js";

// Dynamic loading
export type { DynamicLoadResult } from "./dynamicGrammarLoader.js";
export {
    DynamicGrammarLoader,
    DynamicGrammarCache,
} from "./dynamicGrammarLoader.js";

// NFA system
export type { NFA, NFAState, NFATransition } from "./nfa.js";
export {
    matchNFA,
    sortNFAMatches,
    type NFAMatchResult,
} from "./nfaInterpreter.js";
export { compileGrammarToNFA } from "./nfaCompiler.js";

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
