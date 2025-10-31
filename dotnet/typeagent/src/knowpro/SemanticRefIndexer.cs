// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class SemanticRefIndexer
{
    public static ValueTask AddKnowledgeAsync(
        this ISemanticRefCollection semanticRefs,
        MessageChunkOrdinal ordinal,
        KnowledgeResponse knowledgeResponse,
        CancellationToken cancellationToken = default
    )
    {
        return semanticRefs.AppendAsync(
            knowledgeResponse.ToSemanticRefs(ordinal),
            cancellationToken
        );
    }
}
