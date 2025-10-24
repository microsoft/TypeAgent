// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public static class NormalizedEmbeddingExtensions
{
    /// <summary>
    /// Given a list of normalized embeddings, return the index of the item that is nearest to 'other'
    /// Return
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">normalized embedding to compare against</param>
    /// <returns>The index of the nearest neighbor</returns>
    public static ScoredItem<int> IndexOfNearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding
    )
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
    /// Given a list of normalized embeddings, return the index of the item that is nearest to 'other'
    /// Return
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">normalized embedding to compare against</param>
    /// <returns>The index of the nearest neighbor</returns>
    public static ScoredItem<int> IndexOfNearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        double minScore
    )
    {
        int best = -1;
        double bestScore = double.MinValue;

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = list[i].DotProduct(embedding);
            if (score >= minScore && score > bestScore)
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
    public static void IndexesOfNearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        TopNCollection<int> matches,
        double minScore = double.MinValue
    )
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = list[i].DotProduct(embedding);
            if (score >= minScore)
            {
                matches.Add(i, score);
            }
        }
    }

    /// <summary>
    /// Return indexes of the nearest neighbors of the given embedding
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">embedding to compare against</param>
    /// <param name="maxMatches">max matches</param>
    /// <returns>matches</returns>
    public static List<ScoredItem<int>> IndexesOfNearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        int maxMatches,
        double minScore = double.MinValue
    )
    {
        TopNCollection<int> matches = new TopNCollection<int>(maxMatches);
        list.IndexesOfNearest(embedding, matches, minScore);
        return matches.ByRankAndClear();
    }

    public static IList<ScoredItem<int>> IndexesOfNearest(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        Func<int, bool> filter,
        int maxMatches,
        double minScore = double.MinValue
    )
    {
        ArgumentVerify.ThrowIfNull(filter, nameof(filter));


        var matches = new TopNCollection<int>(maxMatches);

        int best = -1;
        double bestScore = double.MinValue;
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = list[i].DotProduct(embedding);
            if (score > bestScore && filter(i))
            {
                best = i;
                bestScore = score;
            }
        }
        return matches.ByRankAndClear();
    }

    /// <summary>
    /// Finds the indexes of the nearest embeddings within a specified subset.
    /// Searches for the nearest embeddings to a given embedding within a subset of the embeddings array,
    /// defined by the provided ordinals.
    /// </summary>
    /// <param name="list">The full list of candidate embeddings.</param>
    /// <param name="embedding">The embedding to compare against.</param>
    /// <param name="ordinalsOfSubset">An array of indices specifying the subset of embeddings to search.</param>
    /// <param name="maxMatches">The maximum number of matches to return. If not specified, all matches are returned.</param>
    /// <param name="minScore">The minimum similarity score required for a match to be considered valid.</param>
    /// <returns>A list of <see cref="ScoredItem{int}"/> containing the index of a matching embedding and its similarity score.</returns>
    public static List<ScoredItem<int>> IndexesOfNearestInSubset(
        this IList<NormalizedEmbedding> list,
        NormalizedEmbedding embedding,
        IList<int> ordinalsOfSubset,
        int maxMatches,
        double minScore = 0
    )
    {
        ArgumentVerify.ThrowIfNull(ordinalsOfSubset, nameof(ordinalsOfSubset));

        var matches = new TopNCollection<int>(maxMatches);
        for (int i = 0; i < ordinalsOfSubset.Count; ++i)
        {
            int idx = ordinalsOfSubset[i];
            double score = list[idx].DotProduct(embedding);
            if (score >= minScore)
            {
                matches.Add(idx, score);
            }
        }

        return matches.ByRankAndClear();
    }
}

public static class NormalizedEmbeddingBExtensions
{
    public static void IndexesOfNearest(
        this IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> list,
        NormalizedEmbedding embedding,
        TopNCollection<int> matches,
        double minScore = double.MinValue
    )
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        foreach (KeyValuePair<int, NormalizedEmbeddingB> kv in list)
        {
            double score = kv.Value.DotProduct(embedding);
            if (score >= minScore)
            {
                matches.Add(kv.Key, score);
            }
        }
    }

    public static List<ScoredItem<int>> IndexesOfNearest(
        this IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> list,
        NormalizedEmbedding embedding,
        int maxMatches,
        double minScore = double.MinValue
    )
    {
        TopNCollection<int> matches = new TopNCollection<int>(maxMatches);
        list.IndexesOfNearest(embedding, matches, minScore);
        return matches.ByRankAndClear();
    }
}
