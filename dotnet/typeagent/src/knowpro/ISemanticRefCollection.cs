// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ISemanticRefCollection : IAsyncCollection<SemanticRef>
{
}


public static class SemanticRefCollectionExtensions
{
    public static Task<IList<SemanticRef>> GetAsync(
        this ISemanticRefCollection semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {

        return semanticRefs.GetAsync(
            [.. scoredOrdinals.ToSemanticRefOrdinals()],
            cancellationToken
        );
    }

}
