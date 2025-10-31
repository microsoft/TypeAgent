// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class SemanticRefIndexer
{
    public static async ValueTask AddKnowledgeAsync(
        this ISemanticRefCollection semanticRefs,
        MessageChunkOrdinal ordinal,
        KnowledgeResponse knowledgeResponse,
        CancellationToken cancellationToken = default
    )
    {
        TextRange range = ordinal.ToRange();
        if (!knowledgeResponse.Entities.IsNullOrEmpty())
        {
            await semanticRefs.AddAsync(
                range,
                knowledgeResponse.Entities,
                cancellationToken
            ).ConfigureAwait(false);
        }
        if (!knowledgeResponse.Actions.IsNullOrEmpty())
        {
            await semanticRefs.AddAsync(
                range,
                knowledgeResponse.Actions,
                cancellationToken
            ).ConfigureAwait(false);
        }
        if (!knowledgeResponse.InverseActions.IsNullOrEmpty())
        {
            await semanticRefs.AddAsync(
                range,
                knowledgeResponse.InverseActions,
                cancellationToken
            ).ConfigureAwait(false);
        }
        if (!knowledgeResponse.Topics.IsNullOrEmpty())
        {
            await semanticRefs.AddAsync(
                range,
                knowledgeResponse.Topics.Map<string, Topic>((t) => new Topic(t)),
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    private static async ValueTask AddAsync(
        this ISemanticRefCollection semanticRefs,
        TextRange range,
        IEnumerable<Knowledge> knowledge,
        CancellationToken cancellationToken = default
    )
    {
        foreach (var entry in knowledge)
        {
            await semanticRefs.AddKnowledgeAsync(
                range,
                entry,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    public static ValueTask AddKnowledgeAsync(
        this ISemanticRefCollection semanticRefs,
        TextRange range,
        Knowledge knowledge,
        CancellationToken cancellationToken = default
    )
    {
        return semanticRefs.AppendAsync(
            new SemanticRef(knowledge, range),
            cancellationToken
        );
    }
}
