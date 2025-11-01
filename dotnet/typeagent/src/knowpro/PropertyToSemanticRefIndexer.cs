// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// PropertyIndex API implemented as extension methods
/// </summary>
public static class PropertyToSemanticRefIndexer
{
    public static ValueTask AddPropertyAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        string propertyName,
        string propertyValue,
        int semanticRefOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        return propertyIndex.AddPropertyAsync(
            propertyName,
            propertyValue,
            ScoredSemanticRefOrdinal.New(semanticRefOrdinal),
            cancellationToken
        );
    }

    public static ValueTask AddSemanticRefAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        SemanticRef semanticRef,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));
        KnowProVerify.ThrowIfInvalid(semanticRef);

        ValueTask result = ValueTask.CompletedTask;
        switch (semanticRef.KnowledgeType)
        {
            default:
                break;

            case KnowledgeType.EntityTypeName:
                var entity = semanticRef.AsEntity();
                KnowProVerify.ThrowIfInvalid(entity);

                result = propertyIndex.AddEntityPropertiesAsync(
                    entity!,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.ActionTypeName:
                var action = semanticRef.Knowledge as Action;
                KnowProVerify.ThrowIfInvalid(action);

                result = propertyIndex.AddActionPropertiesAsync(
                    action!,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.TagTypeName:
                var tag = semanticRef.Knowledge as Tag;
                KnowProVerify.ThrowIfInvalid(tag);

                result = propertyIndex.AddTagPropertiesAsync(
                    tag!,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.STagTypeName:
                var sTag = semanticRef.Knowledge as StructuredTag;
                KnowProVerify.ThrowIfInvalid(sTag);

                result = propertyIndex.AddEntityPropertiesAsync(
                    sTag!,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;
        }

        return result;
    }

    public static async ValueTask AddSemanticRefsAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        IEnumerable<SemanticRef> semanticRefs,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRefs, nameof(semanticRefs));

        // TODO: Bulk operations
        foreach (var semanticRef in semanticRefs)
        {
            await propertyIndex.AddSemanticRefAsync(
                semanticRef,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static async ValueTask AddEntityPropertiesAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        ConcreteEntity entity,
        int semanticRefOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        KnowProVerify.ThrowIfInvalid(entity);

        // TODO: Bulk operations

        await propertyIndex.AddPropertyAsync(
            KnowledgePropertyName.EntityName,
            entity.Name,
            semanticRefOrdinal,
            cancellationToken
        ).ConfigureAwait(false);

        foreach (var type in entity.Type)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.EntityType,
                type,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }

        // add every facet name as a separate term
        if (entity.HasFacets)
        {
            foreach (var facet in entity.Facets!)
            {
                await propertyIndex.AddFacetAsync(
                    facet,
                    semanticRefOrdinal,
                    cancellationToken
                ).ConfigureAwait(false);
            }
        }

    }

    internal static async ValueTask AddFacetAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        Facet facet,
        int semanticRefOrdinal,
        CancellationToken cancellationToken
    )
    {
        KnowProVerify.ThrowIfInvalid(facet);

        // TODO: Bulk operations
        await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.FacetName,
                facet.Name,
                semanticRefOrdinal,
                cancellationToken
        ).ConfigureAwait(false);

        if (facet.Value is not null)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.FacetValue,
                facet.Value.ToString()!,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static async ValueTask AddActionPropertiesAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        Action action,
        int semanticRefOrdinal,
        CancellationToken cancellationToken
    )
    {
        KnowProVerify.ThrowIfInvalid(action);

        await propertyIndex.AddPropertyAsync(
            KnowledgePropertyName.Verb,
            string.Join(" ", action.Verbs),
            semanticRefOrdinal,
            cancellationToken
        ).ConfigureAwait(false);

        if (action.HasSubject)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.Subject,
                action.SubjectEntityName,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }

        if (action.HasObject)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.Object,
                action.ObjectEntityName,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }

        if (action.HasIndirectObject)
        {
            await propertyIndex.AddPropertyAsync(
                KnowledgePropertyName.IndirectObject,
                action.IndirectObjectEntityName,
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    internal static ValueTask AddTagPropertiesAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        Tag tag,
        int semanticRefOrdinal,
        CancellationToken cancellationToken
)
    {
        KnowProVerify.ThrowIfInvalid(tag);

        return propertyIndex.AddPropertyAsync(
            KnowledgePropertyName.Tag,
            tag.Text,
            semanticRefOrdinal,
            cancellationToken
        );
    }
}
