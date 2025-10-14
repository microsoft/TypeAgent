// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISemanticRefCollection : IAsyncCollection<SemanticRef>
{
}

public static class SemanticRefCollectionExtensions
{
    public static ValueTask<IList<SemanticRef>> GetAsync(
        this IAsyncCollectionReader<SemanticRef> semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {

        return semanticRefs.GetAsync(
            [.. scoredOrdinals.ToSemanticRefOrdinals()],
            cancellationToken
        );
    }

}
