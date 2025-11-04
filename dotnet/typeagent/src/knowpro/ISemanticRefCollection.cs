// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISemanticRefCollection : IAsyncCollection<SemanticRef>
{
    ValueTask<TextRange> GetTextRangeAsync(int ordinal, CancellationToken cancellationToken = default);
    ValueTask<IList<TextRange>> GetTextRangeAsync(IList<int> ordinals, CancellationToken cancellationToken = default);

    ValueTask<KnowledgeType> GetKnowledgeTypeAsync(int ordinal, CancellationToken cancellation = default);
    ValueTask<IList<KnowledgeType>> GetKnowledgeTypeAsync(IList<int> ordinal, CancellationToken cancellation = default);
}

public static class SemanticRefCollectionExtensions
{
    //
    // These methods use IAsyncCollectionReader because then they also work
    // with Caches...see ConversationCache.cs
    //

    public static ValueTask<IList<SemanticRef>> GetAsync(
        this IAsyncCollectionReader<SemanticRef> semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(scoredOrdinals, nameof(scoredOrdinals));

        return semanticRefs.GetAsync(
            [.. scoredOrdinals.ToOrdinals()],
            cancellationToken
        );
    }

    public static async ValueTask<IList<Scored<SemanticRef>>> GetScoredAsync(
        this IAsyncCollectionReader<SemanticRef> semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(scoredOrdinals, nameof(scoredOrdinals));

        IList<SemanticRef> refs = await semanticRefs.GetAsync(
            scoredOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

        List<Scored<SemanticRef>> scored = new List<Scored<SemanticRef>>(refs.Count);
        int count = scoredOrdinals.Count;
        for (int i = 0; i < count; ++i)
        {
            scored.Add(new Scored<SemanticRef>(refs[i], scoredOrdinals[i].Score));
        }

        return scored;
    }

    public static async ValueTask<IList<Scored<ConcreteEntity>>> GetDistinctEntitiesAsync(
        this IAsyncCollectionReader<SemanticRef> semanticRefs,
        IList<ScoredSemanticRefOrdinal> semanticRefMatches,
        int? topK = null
    )
    {
        var scoredEntities = await semanticRefs.GetScoredAsync(
            semanticRefMatches
        ).ConfigureAwait(false);

        Dictionary<string, Scored<MergedEntity>> mergedEntities = MergedEntity.MergeScoredEntities(scoredEntities, false);
        IEnumerable<Scored<ConcreteEntity>> entitites = mergedEntities.Values.Select((v) =>
        {
            return new Scored<ConcreteEntity>(v.Item.ToConcrete(), v.Score);
        });

        return (topK is not null)
            ? entitites.GetTopK(topK.Value)
            : [.. entitites];
    }
}
