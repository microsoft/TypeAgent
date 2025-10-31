// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Microsoft.CodeAnalysis.CSharp;

namespace TypeAgent.KnowPro;

public static class TermToSemanticRefIndexer
{
    // TODO: bulk operations

    public static async ValueTask AddSemanticRefsAsync(
        this ITermToSemanticRefIndex index,
        IEnumerable<SemanticRef> semanticRefs,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        foreach (var sr in semanticRefs)
        {
            await index.AddSemanticRefAsync(
                sr,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    public static async ValueTask AddSemanticRefAsync(
        this ITermToSemanticRefIndex index,
        SemanticRef semanticRef,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));

        switch(semanticRef.KnowledgeType)
        {
            default:
                throw new NotSupportedException(semanticRef.KnowledgeType.ToString());

            case KnowledgeType.EntityTypeName:
                await index.AddEntityAsync(
                    semanticRef.AsEntity(),
                    semanticRef.SemanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
                break;

            case KnowledgeType.ActionTypeName:
                await index.AddActionAsync(
                    semanticRef.AsAction(),
                    semanticRef.SemanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
                break;

            case KnowledgeType.TopicTypeName:
                await index.AddTopicAsync(
                    semanticRef.AsTopic(),
                    semanticRef.SemanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
                break;

            case KnowledgeType.TagTypeName:
                await index.AddTagAsync(
                    semanticRef.AsTag(),
                    semanticRef.SemanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
                break;

            case KnowledgeType.STagTypeName:
                await index.AddSTagAsync(
                    semanticRef.AsSTag(),
                    semanticRef.SemanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
                break;
        }
    }

    public static async ValueTask AddTermAsync(
        this ITermToSemanticRefIndex index,
        string term,
        int semanticRefOrdinal,
        ISet<string>? termsAdded,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrEmpty(term))
        {
            return;
        }

        term = await index.AddTermAsync(
            term,
            ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken
        ).ConfigureAwait(false);

        termsAdded?.Add(term);
    }

    public static async ValueTask AddEntriesAsync(
        this ITermToSemanticRefIndex index,
        string term,
        ScoredSemanticRefOrdinal[] entries,
        CancellationToken cancellationToken = default
    )
    {
        // TODO: Bulk operations
        foreach (var entry in entries)
        {
            await index.AddTermAsync(term, entry, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Adds an entity (name, types, and all facet names/values) to the term-to-semanticRef index.
    /// </summary>
    internal static async ValueTask AddEntityAsync(
        this ITermToSemanticRefIndex index,
        ConcreteEntity? entity,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        if (entity is null)
        {
            return;
        }

        KnowProVerify.ThrowIfInvalid(entity);

        await index.AddTermAsync(
            entity.Name,
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);

        foreach (var type in entity.Type)
        {
            await index.AddTermAsync(
                type,
                semanticRefOrdinal,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }

        // Add facets
        if (entity.Facets is not null)
        {
            foreach (var facet in entity.Facets)
            {
                await index.AddFacetAsync(
                    facet,
                    semanticRefOrdinal,
                    termsAdded,
                    cancellationToken
                ).ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Adds a single facet (its name and value) to the term-to-semanticRef index.
    /// Ported from the TypeScript addFacet function.
    /// </summary>
    internal static async ValueTask AddFacetAsync(
        this ITermToSemanticRefIndex index,
        Facet? facet,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        if (facet is null)
        {
            return;
        }

        KnowProVerify.ThrowIfInvalid(facet);

        await index.AddTermAsync(
            facet.Name,
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);

        // Add facet value (string form)
        if (facet.Value is not null)
        {
            await index.AddTermAsync(
                facet.ToString(),
                semanticRefOrdinal,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static async ValueTask AddTopicAsync(
        this ITermToSemanticRefIndex index,
        Topic topic,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        await index.AddTermAsync(
            topic.Text,
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);
    }

    internal static async ValueTask AddActionAsync(
        this ITermToSemanticRefIndex index,
        Action action,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        KnowProVerify.ThrowIfInvalid(action);

        await index.AddTermAsync(
            action.VerbString(),
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);

        if (action.HasSubject)
        {
            await index.AddTermAsync(
                action.SubjectEntityName,
                semanticRefOrdinal,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }

        if (action.HasObject)
        {
            await index.AddTermAsync(
                action.ObjectEntityName,
                semanticRefOrdinal,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }

        if (action.HasIndirectObject)
        {
            await index.AddTermAsync(
                action.IndirectObjectEntityName,
                semanticRefOrdinal,
                termsAdded,
                cancellationToken
            ).ConfigureAwait(false);
        }

        if (!action.Params.IsNullOrEmpty())
        {
            foreach (var param in action.Params)
            {
                if (param is StringActionParam sp)
                {
                    await index.AddTermAsync(
                        sp.Value,
                        semanticRefOrdinal,
                        termsAdded,
                        cancellationToken
                    ).ConfigureAwait(false);
                }
                else if (param is ActionParam ap)
                {
                    await index.AddTermAsync(
                        ap.Name,
                        semanticRefOrdinal,
                        termsAdded,
                        cancellationToken
                    ).ConfigureAwait(false);

                    await index.AddTermAsync(
                        ap.Value,
                        semanticRefOrdinal,
                        termsAdded,
                        cancellationToken
                    ).ConfigureAwait(false);
                }
            }
        }
    }

    internal static async ValueTask AddTagAsync(
        this ITermToSemanticRefIndex index,
        Tag tag,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        await index.AddTermAsync(
            tag.Text,
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);
    }

    internal static async ValueTask AddSTagAsync(
        this ITermToSemanticRefIndex index,
        StructuredTag tag,
        int semanticRefOrdinal,
        ISet<string>? termsAdded = null,
        CancellationToken cancellationToken = default
    )
    {
        await index.AddEntityAsync(
            tag,
            semanticRefOrdinal,
            termsAdded,
            cancellationToken
        ).ConfigureAwait(false);
    }

}
