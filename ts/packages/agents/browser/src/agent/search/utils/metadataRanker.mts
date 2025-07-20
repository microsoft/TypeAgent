// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Website } from "website-memory";
import { QueryAnalysis } from "../schema/queryAnalysis.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:metadata-ranking");

export class MetadataRanker {
    /**
     * Rank results based on comprehensive LLM analysis
     * Always applies full ranking logic for maximum accuracy
     */
    async rankByAnalysis(
        results: Website[],
        analysis: QueryAnalysis,
    ): Promise<Website[]> {
        if (!analysis.ranking) {
            debug("No ranking requirements in analysis, using semantic order");
            return results;
        }

        debug(
            `Ranking ${results.length} results by ${analysis.ranking.primaryFactor} (${analysis.ranking.direction})`,
        );

        const rankedResults = [...results];

        switch (analysis.ranking.primaryFactor) {
            case "date":
                return this.rankByDate(rankedResults, analysis);
            case "frequency":
                return this.rankByFrequency(rankedResults, analysis);
            case "composite":
                return this.rankByComposite(rankedResults, analysis);
            case "relevance":
            default:
                debug("Using semantic relevance ranking");
                return rankedResults; // Keep original semantic ranking
        }
    }

    private rankByDate(results: Website[], analysis: QueryAnalysis): Website[] {
        debug("Applying date-based ranking");

        return results.sort((a, b) => {
            const aDate = this.getRelevantDate(a, analysis);
            const bDate = this.getRelevantDate(b, analysis);

            const comparison =
                analysis.ranking?.direction === "ascending"
                    ? aDate.getTime() - bDate.getTime()
                    : bDate.getTime() - aDate.getTime();

            return comparison;
        });
    }

    private rankByFrequency(
        results: Website[],
        analysis: QueryAnalysis,
    ): Website[] {
        debug("Applying frequency-based ranking");

        return results.sort((a, b) => {
            const aMetadata = a.metadata as any;
            const bMetadata = b.metadata as any;

            const aCount = aMetadata.visitCount || 0;
            const bCount = bMetadata.visitCount || 0;

            const comparison =
                analysis.ranking?.direction === "ascending"
                    ? aCount - bCount
                    : bCount - aCount;

            return comparison;
        });
    }

    private rankByComposite(
        results: Website[],
        analysis: QueryAnalysis,
    ): Website[] {
        debug("Applying composite ranking based on LLM analysis");

        return results.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // Get weights based on LLM-determined intent
            const weights = this.getCompositeWeights(analysis);
            debug(`Using composite weights: ${JSON.stringify(weights)}`);

            // Date factor
            if (weights.date > 0) {
                const aDate = this.getRelevantDate(a, analysis).getTime();
                const bDate = this.getRelevantDate(b, analysis).getTime();
                const maxTime = Math.max(aDate, bDate);
                const minTime = Math.min(aDate, bDate);
                const range = maxTime - minTime || 1;

                scoreA += ((aDate - minTime) / range) * weights.date;
                scoreB += ((bDate - minTime) / range) * weights.date;
            }

            // Frequency factor
            if (weights.frequency > 0) {
                const aCount = (a.metadata as any).visitCount || 0;
                const bCount = (b.metadata as any).visitCount || 0;
                const maxCount = Math.max(aCount, bCount);
                const range = maxCount || 1;

                scoreA += (aCount / range) * weights.frequency;
                scoreB += (bCount / range) * weights.frequency;
            }

            // Knowledge richness factor
            if (weights.knowledge > 0) {
                const aKnowledge = this.calculateKnowledgeRichness(a);
                const bKnowledge = this.calculateKnowledgeRichness(b);
                scoreA += aKnowledge * weights.knowledge;
                scoreB += bKnowledge * weights.knowledge;
            }

            return scoreB - scoreA; // Higher score wins
        });
    }

    private getRelevantDate(website: Website, analysis: QueryAnalysis): Date {
        const metadata = website.metadata as any;

        // Choose date field based on source preference from LLM analysis
        if (analysis.ranking?.sourcePreference === "bookmark") {
            return new Date(metadata.bookmarkDate || metadata.visitDate || 0);
        }

        return new Date(metadata.visitDate || metadata.bookmarkDate || 0);
    }

    private getCompositeWeights(analysis: QueryAnalysis): {
        date: number;
        frequency: number;
        knowledge: number;
    } {
        // Determine weights based on query intent from LLM analysis
        switch (analysis.intent.type) {
            case "find_latest":
            case "find_earliest":
                return { date: 0.8, frequency: 0.1, knowledge: 0.1 };

            case "find_most_frequent":
                return { date: 0.1, frequency: 0.8, knowledge: 0.1 };

            case "summarize":
                return { date: 0.3, frequency: 0.2, knowledge: 0.5 };

            default:
                return { date: 0.4, frequency: 0.3, knowledge: 0.3 };
        }
    }

    private calculateKnowledgeRichness(website: Website): number {
        const knowledge = website.getKnowledge?.();
        if (!knowledge) return 0;

        let richness = 0;

        if (knowledge.entities) {
            richness += knowledge.entities.length * 0.3;
        }

        if (knowledge.topics) {
            richness += knowledge.topics.length * 0.2;
        }

        if (knowledge.actions) {
            richness += knowledge.actions.length * 0.1;
        }

        const textChunks = website.textChunks || [];
        const totalLength = textChunks.join(" ").length;
        richness += Math.min(totalLength / 1000, 2.0) * 0.4;

        return Math.min(richness, 10.0) / 10.0; // Normalize to 0-1
    }
}
