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
    public static Scored<int> IndexOfNearest<T, TOther>(this IList<T> list, TOther embedding)
        where TOther : ICosineSimilarity<T>
    {
        int best = -1;
        double bestScore = double.MinValue;

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = embedding.CosineSimilarity(list[i]);
            if (score > bestScore)
            {
                best = i;
                bestScore = score;
            }
        }
        return new Scored<int>(best, bestScore);
    }

    /// <summary>
    /// Given a list of normalized embeddings, return the index of the item that is nearest to 'other'
    /// Return
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">normalized embedding to compare against</param>
    /// <returns>The index of the nearest neighbor</returns>
    public static Scored<int> IndexOfNearest<T, TOther>(this IList<T> list, TOther embedding, double minScore)
        where TOther : ICosineSimilarity<T>
    {
        int best = -1;
        double bestScore = double.MinValue;

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = embedding.CosineSimilarity(list[i]);
            if (score >= minScore && score > bestScore)
            {
                best = i;
                bestScore = score;
            }
        }
        return new Scored<int>(best, bestScore);
    }


    /// <summary>
    /// Return indexes of the nearest neighbors of the given embedding
    /// </summary>
    /// <param name="list">list of candidate embeddings</param>
    /// <param name="embedding">embedding to compare against</param>
    /// <param name="matches">match collector</param>
    /// <returns>matches</returns>
    public static void IndexesOfNearest<T, TOther>(
        this IList<T> list,
        TOther embedding,
        TopNCollection<int> matches,
        double minScore = double.MinValue
    )
        where TOther : ICosineSimilarity<T>
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = embedding.CosineSimilarity(list[i]);
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
    public static List<Scored<int>> IndexesOfNearest<T, TOther>(
        this IList<T> list,
        TOther embedding,
        int maxMatches,
        double minScore = double.MinValue
    )
        where TOther : ICosineSimilarity<T>
    {
        TopNCollection<int> matches = new TopNCollection<int>(maxMatches);
        list.IndexesOfNearest(embedding, matches, minScore);
        return matches.ByRankAndClear();
    }

    public static IList<Scored<int>> IndexesOfNearest<T, TOther>(
        this IList<T> list,
        TOther embedding,
        Func<int, bool> filter,
        int maxMatches,
        double minScore = double.MinValue
    )
        where TOther : ICosineSimilarity<T>
    {
        ArgumentVerify.ThrowIfNull(filter, nameof(filter));

        var matches = new TopNCollection<int>(maxMatches);

        int best = -1;
        double bestScore = double.MinValue;
        int count = list.Count;
        for (int i = 0; i < count; ++i)
        {
            double score = embedding.CosineSimilarity(list[i]);
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
    /// <returns>A list of <see cref="Scored{int}"/> containing the index of a matching embedding and its similarity score.</returns>
    public static List<Scored<int>> IndexesOfNearestInSubset<T, TOther>(
        this IList<T> list,
        TOther embedding,
        IList<int> ordinalsOfSubset,
        int maxMatches,
        double minScore = 0
    )
        where TOther : ICosineSimilarity<T>
    {
        ArgumentVerify.ThrowIfNull(ordinalsOfSubset, nameof(ordinalsOfSubset));

        var matches = new TopNCollection<int>(maxMatches);
        for (int i = 0; i < ordinalsOfSubset.Count; ++i)
        {
            int idx = ordinalsOfSubset[i];
            double score = embedding.CosineSimilarity(list[idx]);
            if (score >= minScore)
            {
                matches.Add(idx, score);
            }
        }

        return matches.ByRankAndClear();
    }

    public static void KeysOfNearest<T, TOther>(
        this IEnumerable<KeyValuePair<int, T>> list,
        TOther embedding,
        TopNCollection<int> matches,
        double minScore = double.MinValue,
        Func<int, bool>? filter = null
    )
        where TOther : ICosineSimilarity<T>
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        if (filter is null)
        {
            foreach (KeyValuePair<int, T> kv in list)
            {
                double score = embedding.CosineSimilarity(kv.Value);
                if (score >= minScore)
                {
                    matches.Add(kv.Key, score);
                }
            }
        }
        else
        {
            foreach (KeyValuePair<int, T> kv in list)
            {
                if (filter(kv.Key))
                {
                    double score = embedding.CosineSimilarity(kv.Value);
                    if (score >= minScore)
                    {
                        matches.Add(kv.Key, score);
                    }

                }
            }
        }
    }

    public static List<Scored<int>> KeysOfNearest<T, TOther>(
        this IEnumerable<KeyValuePair<int, T>> list,
        TOther embedding,
        int maxMatches,
        double minScore = double.MinValue,
        Func<int, bool>? filter = null
    )
        where TOther : ICosineSimilarity<T>
    {
        TopNCollection<int> matches = new TopNCollection<int>(maxMatches);
        list.KeysOfNearest(embedding, matches, minScore, filter);
        return matches.ByRankAndClear();
    }
}

