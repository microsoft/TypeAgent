// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { UnifiedExtractionMode } from "../unified/types.mjs";

export interface ModeSelectionProps {
    currentMode: UnifiedExtractionMode;
    availableModes: UnifiedExtractionMode[];
    aiModelAvailable: boolean;
    onModeChange: (mode: UnifiedExtractionMode) => void;
    disabled?: boolean;
    showDescription?: boolean;
}

export interface ModeInfo {
    mode: UnifiedExtractionMode;
    displayName: string;
    description: string;
    requiresAI: boolean;
    performance: "fastest" | "fast" | "medium" | "thorough";
    quality: "basic" | "good" | "high" | "excellent";
    useCases: string[];
    concurrency: number;
}

export const MODE_CONFIGURATIONS: Record<UnifiedExtractionMode, ModeInfo> = {
    basic: {
        mode: "basic",
        displayName: "Basic",
        description: "Fast metadata extraction with no AI requirements",
        requiresAI: false,
        performance: "fastest",
        quality: "basic",
        useCases: [
            "Bulk imports",
            "Fast indexing",
            "Low-resource environments",
        ],
        concurrency: 10,
    },
    content: {
        mode: "content",
        displayName: "Content Analysis",
        description: "AI-powered content analysis for better search quality",
        requiresAI: true,
        performance: "fast",
        quality: "good",
        useCases: [
            "Quality indexing",
            "Content discovery",
            "Search optimization",
        ],
        concurrency: 5,
    },
    actions: {
        mode: "actions",
        displayName: "Interactive Analysis",
        description: "AI analysis with action detection for interactive pages",
        requiresAI: true,
        performance: "medium",
        quality: "high",
        useCases: ["Web apps", "Interactive sites", "Action extraction"],
        concurrency: 3,
    },
    full: {
        mode: "full",
        displayName: "Complete Analysis",
        description: "Comprehensive AI analysis with relationships",
        requiresAI: true,
        performance: "thorough",
        quality: "excellent",
        useCases: ["Detailed extraction", "Research", "Knowledge graphs"],
        concurrency: 2,
    },
};

export function getModeDisplayInfo(mode: UnifiedExtractionMode): ModeInfo {
    return MODE_CONFIGURATIONS[mode];
}

export function validateModeSelection(
    mode: UnifiedExtractionMode,
    aiModelAvailable: boolean,
): boolean {
    const modeInfo = MODE_CONFIGURATIONS[mode];
    return !modeInfo.requiresAI || aiModelAvailable;
}

export interface BatchOperationProgress {
    mode: UnifiedExtractionMode;
    totalItems: number;
    processedItems: number;
    currentItem: string;
    percentage: number;
    errors: number;
    estimatedTimeRemaining: number;
    stage: "validating" | "processing" | "enhancing" | "complete";
}

export function formatProgressMessage(
    progress: BatchOperationProgress,
): string {
    const modeInfo = MODE_CONFIGURATIONS[progress.mode];
    const stage = getStageLabel(progress.stage);

    return `${stage}: ${progress.percentage}% (${progress.processedItems}/${progress.totalItems}) - ${modeInfo.displayName} mode`;
}

function getStageLabel(stage: string): string {
    const stageLabels: Record<string, string> = {
        validating: "Validating Requirements",
        processing: "Processing Content",
        enhancing: "Enhancing Knowledge",
        complete: "Complete",
    };
    return stageLabels[stage] || stage;
}

export function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
}
