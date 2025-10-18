// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public static class EmbeddingExtensions
{
    /// <summary>
    /// Given a list of normalized embeddings, return the index of the item that is nearest to 'other'
    /// Return
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">normalized embedding to compare against</param>
    /// <returns>The index of the nearest neighbor</returns>
    public static ScoredItem<int> IndexOfNearest(this IList<NormalizedEmbedding> list, NormalizedEmbedding embedding)
    {
        int best = -1;
        double bestScore = double.MinValue;

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = list[i].DotProduct(embedding);
            if (score > bestScore)
            {
                best = i;
                bestScore = score;
            }
        }
        return new ScoredItem<int>(best, bestScore);
    }

    /// <summary>
    /// Return indexes of the nearest neighbors of the given embedding
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">embedding to compare against</param>
    /// <param name="matches">match collector</param>
    /// <returns>matches</returns>
    public static void Nearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        TopNCollection<int> matches
    )
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = list[i].DotProduct(embedding);
            matches.Add(i, score);
        }
    }

    /// <summary>
    /// Return indexes of the nearest neighbors of the given embedding
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">embedding to compare against</param>
    /// <param name="maxMatches">max matches</param>
    /// <returns>matches</returns>
    public static List<ScoredItem<int>> Nearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        int maxMatches
    )
    {
        TopNCollection<int> matches = new TopNCollection<int>(maxMatches);
        list.Nearest(embedding, matches);
        return matches.ByRankAndClear();
    }
}
