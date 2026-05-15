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
    loadCanonicalTrademarks,
    validateTrademarks,
    type TrademarksValidation,
} from "./trademarksGuard.js";
export {
    detectAgentSurface,
    hasAgentSurface,
    type AgentSurface,
} from "./agentSurface.js";
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
    OVERVIEW_TARGET_WORDS_MIN,
    OVERVIEW_TARGET_WORDS_MAX,
    OVERVIEW_HARD_CAP_WORDS,
    TOTAL_BLOCK_HARD_CAP_WORDS,
    COMPACT_LINE_THRESHOLD,
    COMPACT_EXPORTS_THRESHOLD,
} from "./lengthCaps.js";
export { renderReferenceSection } from "./renderReference.js";
export { renderOverviewSection } from "./renderOverview.js";
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
    assembleOverviewPrompt,
    type AssembledPrompt,
    type PromptOptions,
} from "./promptAssembly.js";
export {
    countOverviewWords,
    validateOverview,
    type OverviewValidation,
} from "./overviewValidation.js";
export {
    generateOverview,
    type OverviewChatModel,
    type ChatPromptSection,
    type OverviewResult,
    type OverviewStatus,
    type GenerateOverviewOptions,
} from "./generateOverview.js";
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
