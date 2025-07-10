// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { splitLargeTextIntoChunks } from "knowledge-processor";

/**
 * Enhanced chunking utilities that leverage conversation package's intelligent chunking
 * while preserving website-specific functionality.
 */

export interface ChunkingOptions {
    maxCharsPerChunk: number;
    preserveStructure: boolean;
    includeMetadata: boolean;
}

/**
 * Intelligent website content chunking using conversation package's algorithms.
 * This replaces the basic text splitting with semantic-aware chunking.
 */
export function intelligentWebsiteChunking(
    content: string,
    options: ChunkingOptions,
): string[] {
    const { maxCharsPerChunk, preserveStructure } = options;

    // Use conversation package's intelligent chunking
    const chunks = Array.from(
        splitLargeTextIntoChunks(content, maxCharsPerChunk, preserveStructure),
    );

    return chunks;
}

/**
 * Enhanced version of websiteToTextChunks that uses intelligent chunking
 * while maintaining backward compatibility.
 */
export function websiteToTextChunksEnhanced(
    pageContent: string | string[],
    title?: string,
    url?: string,
    maxCharsPerChunk: number = 2000,
): string[] {
    // Handle metadata addition
    const processContent = (content: string): string => {
        return joinTitleUrlAndContent(content, title, url);
    };

    if (Array.isArray(pageContent)) {
        // Process the first chunk with metadata, keep others as-is
        const processedContent = pageContent
            .map((chunk, index) =>
                index === 0 ? processContent(chunk) : chunk,
            )
            .join("\n\n");

        // Apply intelligent chunking to the combined content
        return intelligentWebsiteChunking(processedContent, {
            maxCharsPerChunk,
            preserveStructure: true,
            includeMetadata: true,
        });
    } else {
        const processedContent = processContent(pageContent);

        // Apply intelligent chunking
        return intelligentWebsiteChunking(processedContent, {
            maxCharsPerChunk,
            preserveStructure: true,
            includeMetadata: true,
        });
    }
}

/**
 * Helper function to join title, URL, and content
 * (preserved from original implementation)
 */
function joinTitleUrlAndContent(
    pageContent: string,
    title?: string,
    url?: string,
): string {
    let result = "";
    if (title) {
        result += `Title: ${title}\n`;
    }
    if (url) {
        result += `URL: ${url}\n`;
    }
    if (result) {
        result += "\n";
    }
    result += pageContent;
    return result;
}

/**
 * Analyze chunk quality for testing and optimization
 */
export interface ChunkQualityMetrics {
    averageChunkSize: number;
    chunkSizeVariance: number;
    sentenceBoundaryRespected: number; // percentage
    paragraphBoundaryRespected: number; // percentage
}

export function analyzeChunkQuality(chunks: string[]): ChunkQualityMetrics {
    const sizes = chunks.map((chunk) => chunk.length);
    const averageSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    const variance =
        sizes.reduce((acc, size) => acc + Math.pow(size - averageSize, 2), 0) /
        sizes.length;

    // Simple heuristics for boundary respect (can be enhanced)
    const sentenceBoundaryRespected =
        (chunks.filter((chunk) => chunk.trim().match(/[.!?]$/)).length /
            chunks.length) *
        100;

    const paragraphBoundaryRespected =
        (chunks.filter(
            (chunk) =>
                chunk.trim().startsWith("\n") || chunk.trim().endsWith("\n\n"),
        ).length /
            chunks.length) *
        100;

    return {
        averageChunkSize: averageSize,
        chunkSizeVariance: variance,
        sentenceBoundaryRespected,
        paragraphBoundaryRespected,
    };
}
