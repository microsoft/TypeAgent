// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { Git, type GitRunner, type GitResult, realGit } from "./git.js";
export {
    findRepoRoot,
    findMonorepoRoot,
    toPosixRelative,
    asLinkTarget,
    isUnder,
} from "./paths.js";
export {
    type WorkspacePackage,
    type PackageJson,
    type WorkspaceGraph,
    parseWorkspacePatterns,
    loadWorkspaceFromDisk,
    buildGraph,
} from "./workspaceGraph.js";
export {
    WATERMARK_TAG,
    readWatermark,
    writeWatermark,
    pushWatermark,
} from "./watermark.js";
export {
    DEFAULT_WATCHED_DIRS,
    DEFAULT_WATCHED_FILES,
    type FileAttribution,
    detectChangedPackages,
} from "./changeDetection.js";
export { resolveSinceRef, type SinceResolution } from "./sinceResolver.js";
export {
    START_MARKER,
    END_MARKER,
    findAutogenRegion,
    writeAutogenRegion,
    type AutogenRegion,
} from "./autogenRegion.js";
export {
    HASH_PREFIX,
    HASH_SUFFIX,
    computeContentHash,
    formatHashComment,
    parseHashComment,
} from "./contentHash.js";
export {
    detectAgentSurface,
    hasAgentSurface,
    type AgentSurface,
} from "./agentSurface.js";
export {
    detectImplementedActionNames,
    extractActionsFromSchema,
    extractActionsFromSource,
    markImplementedActions,
    type AgentAction,
    type ActionParameter,
} from "./extractActions.js";
export {
    readReadmeContext,
    stripGeneratedSections,
    type ReadmeContext,
} from "./readReadmeContext.js";
export { collectEnvVarsFromText, detectEnvVars } from "./detectEnvVars.js";
export { extractMarkdownLinks, type ExtractedLink } from "./linkExtraction.js";
export {
    validateLinks,
    type ValidatedLink,
    type LinkValidationResult,
} from "./linkValidation.js";
export {
    type EntryPoint,
    type SourceFile,
    type PackageInputs,
    gatherPackageInputs,
} from "./packageInputs.js";
export { decideCompact, type CompactDecision } from "./compactMode.js";
export {
    FILES_OF_INTEREST_MAX,
    USED_BY_MAX,
    EXTERNAL_DEPS_MAX,
    KEY_CONCEPTS_MAX,
    ACTIONS_REFERENCE_MAX,
    DOCUMENTATION_TARGET_WORDS_MIN,
    DOCUMENTATION_TARGET_WORDS_MAX,
    DOCUMENTATION_HARD_CAP_WORDS,
    TOTAL_BLOCK_HARD_CAP_WORDS,
    COMPACT_LINE_THRESHOLD,
    COMPACT_EXPORTS_THRESHOLD,
} from "./lengthCaps.js";
export { renderReferenceSection } from "./renderReference.js";
export { renderAiDocumentation } from "./renderDocumentation.js";
export {
    repairAbsoluteLinks,
    repairBareCodeFences,
    repairH1Headings,
    repairOutput,
    repairSelfReadmeLinks,
} from "./repairOutput.js";
export {
    stripBrokenLinks,
    type StripBrokenLinksResult,
} from "./stripBrokenLinks.js";
export {
    renderStalenessFooter,
    stripStalenessFooter,
} from "./renderStaleness.js";
export {
    assembleAutogenBlock,
    type AssembledAutogen,
    type AssembleOptions,
} from "./assembleAutogen.js";
export {
    composeAutogenFile,
    writeAutogenFile,
    type WriteResult,
    type WriteVerdict,
} from "./writeAutogenFile.js";
export {
    assembleDocumentationPrompt,
    type AssembledPrompt,
    type PromptOptions,
} from "./promptAssembly.js";
export {
    countDocumentationWords,
    validateDocumentation,
    type DocumentationValidation,
} from "./documentationValidation.js";
export {
    generateDocumentation,
    type DocumentationChatModel,
    type ChatPromptSection,
    type DocumentationResult,
    type DocumentationStatus,
    type GenerateDocumentationOptions,
} from "./generateDocumentation.js";
export {
    compareReadmes,
    type DiffVerdict,
    type DiffResult,
} from "./diffGuard.js";
// Note: ./llm.js is intentionally NOT re-exported here. It pulls in
// `aiclient` at module load, which forces consumers (and tests) to
// have aiclient built and Azure OpenAI env vars present even when
// they only want the deterministic skeleton. Import directly from
// "@typeagent/docs-autogen/llm" or via dynamic import in CLI code.
