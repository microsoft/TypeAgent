import { TextEmbeddingModel } from "aiclient";
import { collections } from "typeagent";
import { Result, success } from "typechat";

export function createEmbeddingCache(
    model: TextEmbeddingModel,
    cacheSize: number,
): TextEmbeddingModel {
    const cache: collections.Cache<string, number[]> =
        collections.createLRUCache(cacheSize);
    return {
        generateEmbedding,
    };

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        let embedding = cache.get(input);
        if (embedding) {
            return success(embedding);
        }
        const result = await model.generateEmbedding(input);
        if (result.success) {
            cache.put(input, result.data);
        }
        return result;
    }
}
