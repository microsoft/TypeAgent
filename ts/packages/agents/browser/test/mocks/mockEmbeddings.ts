// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class MockEmbeddings {
    private static embeddingCache: Map<string, number[]> = new Map();
    private static readonly EMBEDDING_DIM = 384;

    static generateDeterministicEmbedding(text: string): number[] {
        if (this.embeddingCache.has(text)) {
            return this.embeddingCache.get(text)!;
        }

        const embedding = new Array(this.EMBEDDING_DIM).fill(0);

        const hash = this.simpleHash(text);
        const seed = hash / 2147483647;

        for (let i = 0; i < this.EMBEDDING_DIM; i++) {
            const angle = ((hash + i) / this.EMBEDDING_DIM) * 2 * Math.PI;
            embedding[i] = Math.cos(angle) * seed;
        }

        const norm = Math.sqrt(
            embedding.reduce((sum, val) => sum + val * val, 0),
        );
        const normalized = embedding.map((val) => val / norm);

        this.embeddingCache.set(text, normalized);
        return normalized;
    }

    static cosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) {
            throw new Error("Vectors must have same length");
        }

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    static semanticSearch(
        query: string,
        documents: Array<{ text: string; metadata?: any }>,
        topK: number = 10,
    ): Array<{ text: string; metadata?: any; score: number }> {
        const queryEmbedding = this.generateDeterministicEmbedding(query);

        const scored = documents.map((doc) => {
            const docEmbedding = this.generateDeterministicEmbedding(doc.text);
            const score = this.cosineSimilarity(queryEmbedding, docEmbedding);

            const keywordBoost = this.calculateKeywordBoost(query, doc.text);

            return {
                ...doc,
                score: score * 0.7 + keywordBoost * 0.3,
            };
        });

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, topK);
    }

    private static calculateKeywordBoost(query: string, text: string): number {
        const queryTokens = query
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length > 3);
        const textLower = text.toLowerCase();

        let matches = 0;
        for (const token of queryTokens) {
            if (textLower.includes(token)) {
                matches++;
            }
        }

        return queryTokens.length > 0 ? matches / queryTokens.length : 0;
    }

    private static simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    static clearCache(): void {
        this.embeddingCache.clear();
    }

    static async mockEmbedText(text: string): Promise<number[]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.generateDeterministicEmbedding(text));
            }, 5);
        });
    }

    static async mockBatchEmbed(texts: string[]): Promise<number[][]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(
                    texts.map((t) => this.generateDeterministicEmbedding(t)),
                );
            }, 10);
        });
    }

    static getPrecomputedEmbeddings(): {
        [key: string]: number[];
    } {
        return {
            "Atlas Mountains": this.generateDeterministicEmbedding(
                "Atlas Mountains mountain range North Africa Morocco Algeria Tunisia",
            ),
            "Mount Toubkal": this.generateDeterministicEmbedding(
                "Mount Toubkal highest peak Atlas Mountains 4167 meters Morocco",
            ),
            Morocco: this.generateDeterministicEmbedding(
                "Morocco North African country Mediterranean Atlas Mountains",
            ),
            Pyrenees: this.generateDeterministicEmbedding(
                "Pyrenees mountain range France Spain Alpine orogeny",
            ),
            Alps: this.generateDeterministicEmbedding(
                "Alps mountain range Europe Alpine orogeny Mont Blanc",
            ),
            Geography: this.generateDeterministicEmbedding(
                "Geography physical features mountains terrain elevation",
            ),
            Geology: this.generateDeterministicEmbedding(
                "Geology rock formation tectonic plates orogeny",
            ),
        };
    }
}
