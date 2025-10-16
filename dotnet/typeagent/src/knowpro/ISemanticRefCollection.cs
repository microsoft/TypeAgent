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
    public static ValueTask<IList<SemanticRef>> GetAsync(
        this IAsyncCollectionReader<SemanticRef> semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {

        return semanticRefs.GetAsync(
            [.. scoredOrdinals.ToOrdinals()],
            cancellationToken
        );
    }

}
