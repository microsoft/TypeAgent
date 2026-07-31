// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CollisionAction =
    | ShowCollisionEventsAction
    | FindSimilarActionsAction
    | ListCollisionStrategiesAction
    | ProbeCollisionPhraseAction
    | GenerateCollisionCorpusAction
    | ProbeCollisionCorpusAction
    | TranslateCollisionCorpusAction
    | ReanalyzeCollisionCorpusAction
    | VisualizeCollisionCorpusAction
    | RunCollisionCorpusPipelineAction
    | AnalyzeCollisionRecoveryAction
    | VisualizeCollisionRecoveryAction
    | ManageCollisionKeywordsAction
    | BackfillCollisionKeywordsAction
    | BuildCollisionNeighborhoodsAction
    | ListCollisionOptimizationLeversAction
    | ExploreCollisionOptimizationsAction
    | ValidateCollisionOptimizationsAction
    | MineCollisionOptimizationPatternsAction
    | RunCollisionOptimizationPipelineAction
    | DistillCollisionOptimizationPatternsAction
    | BrowseCollisionOptimizationRunsAction
    | ListCollisionPreferencesAction
    | SetCollisionPreferenceAction
    | RemoveCollisionPreferenceAction
    | ClearCollisionPreferencesAction;

export type CollisionSeverity = "blocker" | "leaky" | "minor";

// Show recent collision telemetry events from this session.
export type ShowCollisionEventsAction = {
    actionName: "showCollisionEvents";
    parameters?: {
        limit?: number;
        kind?: "static" | "grammarMatch" | "llmSelect" | "fuzzy";
    };
};

// Find semantically similar actions across agents.
export type FindSimilarActionsAction = {
    actionName: "findSimilarActions";
    parameters?: {
        threshold?: number;
        strategy?: string;
        allStrategies?: boolean;
        pairs?: boolean;
        top?: number;
        jsonPath?: string;
        noCache?: boolean;
    };
};

// List available action-similarity scoring strategies.
export type ListCollisionStrategiesAction = {
    actionName: "listCollisionStrategies";
};

// Probe how the embedding ranker routes one phrase.
export type ProbeCollisionPhraseAction = {
    actionName: "probeCollisionPhrase";
    parameters: {
        phrase: string;
        top?: number;
        expected?: string;
        delta?: number;
        includeInactive?: boolean;
    };
};

// Generate an LLM-authored phrase corpus for loaded action schemas.
export type GenerateCollisionCorpusAction = {
    actionName: "generateCollisionCorpus";
    parameters?: {
        schemas?: string[];
        models?: string[];
        styles?: string[];
        concurrency?: number;
        outputPath?: string;
        workdir?: string;
    };
};

// Replay a phrase corpus through the embedding ranker.
export type ProbeCollisionCorpusAction = {
    actionName: "probeCollisionCorpus";
    parameters?: {
        inputPath?: string;
        outputPath?: string;
        top?: number;
        delta?: number;
        concurrency?: number;
        workdir?: string;
    };
};

// Replay a phrase corpus through the LLM translator.
export type TranslateCollisionCorpusAction = {
    actionName: "translateCollisionCorpus";
    parameters?: {
        inputPath?: string;
        outputPath?: string;
        concurrency?: number;
        strategy?: "first-match" | "score-rank" | "priority" | "user-clarify";
        maxPhrases?: number;
        modelLabel?: string;
        userContextMode?: "none" | "expected-schema" | "fixed";
        userContextJson?: string;
        outputSuffix?: string;
        workdir?: string;
    };
};

// Reclassify saved collision probe results using a new threshold.
export type ReanalyzeCollisionCorpusAction = {
    actionName: "reanalyzeCollisionCorpus";
    parameters?: {
        inputPath?: string;
        outputPath?: string;
        delta?: number;
        workdir?: string;
    };
};

// Render the collision corpus analysis as a self-contained HTML report.
export type VisualizeCollisionCorpusAction = {
    actionName: "visualizeCollisionCorpus";
    parameters?: {
        inputPath?: string;
        outputPath?: string;
        top?: number;
        similarityStrategy?: string;
        similarityThreshold?: number;
        noSimilarity?: boolean;
        translatorPath?: string;
        noTranslator?: boolean;
        workdir?: string;
    };
};

// Run or resume the collision corpus pipeline.
export type RunCollisionCorpusPipelineAction = {
    actionName: "runCollisionCorpusPipeline";
    parameters?: {
        from?: "generate" | "probe" | "reanalyze" | "visualize";
        workdir?: string;
        schemas?: string[];
        models?: string[];
        styles?: string[];
        concurrency?: number;
        delta?: number;
        top?: number;
        sankeyTop?: number;
    };
};

// Analyze whether alternate candidates could recover corpus misroutes.
export type AnalyzeCollisionRecoveryAction = {
    actionName: "analyzeCollisionRecovery";
    parameters?: {
        inputPath?: string;
        workdir?: string;
        delta?: number;
    };
};

// Render collision recovery analysis as HTML.
export type VisualizeCollisionRecoveryAction = {
    actionName: "visualizeCollisionRecovery";
    parameters?: {
        inputPath?: string;
        outputPath?: string;
        delta?: number;
        workdir?: string;
    };
};

// Inspect or modify context-selector keyword overrides.
export type ManageCollisionKeywordsAction = {
    actionName: "manageCollisionKeywords";
    parameters?: {
        operation?: "listOverrides" | "show" | "add" | "remove" | "clear";
        target?: string;
        keywords?: string[];
    };
};

// Generate missing context-selector keywords for loaded schemas.
export type BackfillCollisionKeywordsAction = {
    actionName: "backfillCollisionKeywords";
    parameters?: {
        schemas?: string[];
        useLlm?: boolean;
        force?: boolean;
    };
};

// Build collision neighborhoods from translator misroute edges.
export type BuildCollisionNeighborhoodsAction = {
    actionName: "buildCollisionNeighborhoods";
    parameters?: {
        corpusPath?: string;
        minMisroute?: number;
        includeSameSchema?: boolean;
        samplesPerCategory?: number;
        outputPath?: string;
        outputHtmlPath?: string;
        workdir?: string;
    };
};

// List registered collision-optimization levers.
export type ListCollisionOptimizationLeversAction = {
    actionName: "listCollisionOptimizationLevers";
};

// Explore optimization hypotheses for collision neighborhoods.
export type ExploreCollisionOptimizationsAction = {
    actionName: "exploreCollisionOptimizations";
    parameters?: {
        corpusPath?: string;
        baselinePath?: string;
        top?: number;
        hypothesesPerLever?: number;
        depth?: number;
        levers?: string[];
        severities?: CollisionSeverity[];
        workdir?: string;
        dryRun?: boolean;
        concurrency?: number;
    };
};

// Stack optimization winners and re-probe the baseline corpus.
export type ValidateCollisionOptimizationsAction = {
    actionName: "validateCollisionOptimizations";
    parameters?: {
        runId?: string;
        neighborhoodId?: string;
        baselinePath?: string;
        workdir?: string;
        winners?: string[];
        leaveOneOut?: string[];
    };
};

// Mine cross-run collision optimization patterns.
export type MineCollisionOptimizationPatternsAction = {
    actionName: "mineCollisionOptimizationPatterns";
    parameters?: {
        patternsFile?: string;
        minAttempts?: number;
        surfaceDisagreement?: number;
        outputPath?: string;
        outputHtmlPath?: string;
        workdir?: string;
    };
};

// Run or resume the collision optimization pipeline.
export type RunCollisionOptimizationPipelineAction = {
    actionName: "runCollisionOptimizationPipeline";
    parameters?: {
        from?:
            | "neighborhoods"
            | "explore"
            | "validate"
            | "patterns"
            | "distill";
        top?: number;
        depth?: number;
        levers?: string[];
        severities?: CollisionSeverity[];
        dryRun?: boolean;
        skipDistill?: boolean;
        distillMinAttempts?: number;
        workdir?: string;
    };
};

// Distill winning optimization attempts into candidate schema guidelines.
export type DistillCollisionOptimizationPatternsAction = {
    actionName: "distillCollisionOptimizationPatterns";
    parameters?: {
        minAttempts?: number;
        workdir?: string;
    };
};

// Generate browse pages for collision optimization runs.
export type BrowseCollisionOptimizationRunsAction = {
    actionName: "browseCollisionOptimizationRuns";
    parameters?: {
        runId?: string;
        all?: boolean;
        workdir?: string;
    };
};

// List stored collision preferences.
export type ListCollisionPreferencesAction = {
    actionName: "listCollisionPreferences";
};

// Set an explicit preference among a set of competing actions.
export type SetCollisionPreferenceAction = {
    actionName: "setCollisionPreference";
    parameters: {
        candidates: string[];
        chosen: string;
    };
};

// Remove one stored collision preference by key.
export type RemoveCollisionPreferenceAction = {
    actionName: "removeCollisionPreference";
    parameters: { key: string };
};

// Remove all stored collision preferences.
export type ClearCollisionPreferencesAction = {
    actionName: "clearCollisionPreferences";
};
