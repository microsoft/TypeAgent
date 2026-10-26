// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Matching and compilation only. Generation and persistent stores are separate.
export { registerBuiltInEntities } from "./builtInEntities.js";
export { EntityRegistry, globalEntityRegistry } from "./entityRegistry.js";
export type { EntityConverter, EntityValidator } from "./entityRegistry.js";
export type { FileLoader, SchemaLoader } from "./grammarCompiler.js";
export { grammarFromJson } from "./grammarDeserializer.js";
export { loadGrammarRules, loadGrammarRulesNoThrow } from "./grammarLoader.js";
export type { LoadGrammarRulesOptions } from "./grammarLoader.js";
export { matchGrammar } from "./grammarMatcher.js";
export type {
    GrammarMatchOptions,
    GrammarMatchResult,
} from "./grammarMatcher.js";
export { grammarToJson } from "./grammarSerializer.js";
export type {
    Grammar,
    GrammarJson,
    GrammarPart,
    GrammarRule,
} from "./grammarTypes.js";
export { compileGrammarToNFA } from "./nfaCompiler.js";
export { matchGrammarWithNFA } from "./nfaMatcher.js";
export type { NFAGrammarMatchResult } from "./nfaMatcher.js";
