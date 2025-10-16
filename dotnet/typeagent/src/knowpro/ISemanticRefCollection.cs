// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISemanticRefCollection : IAsyncCollection<SemanticRef>
{
    ValueTask<TextRange> GetRangeAsync(int ordinal, CancellationToken cancellationToken = default);
    ValueTask<IList<TextRange>> GetRangesAsync(IList<int> ordinals, CancellationToken cancellationToken = default);
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
