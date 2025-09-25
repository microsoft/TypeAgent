// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// PropertyIndex API implemented as extension methods
/// </summary>
public static class PropertyToSemanticRefIndexExtensions
{
    public static Task AddPropertyAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        string propertyName, string value,
        int semanticRefOrdinal,
        CancellationToken cancellationToken = default
    )
    {
        return propertyIndex.AddPropertyAync(propertyName, value, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }

    public static Task AddSemanticRefAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        SemanticRef semanticRef,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));

        Task result = null;
        switch(semanticRef.KnowledgeType)
        {
            default:
                break;

            case KnowledgeType.Entity:
                result = propertyIndex.AddEntityPropertiesAsync(
                    semanticRef.Knowledge as ConcreteEntity,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.Action:
                result = propertyIndex.AddActionPropertiesAsync(
                    semanticRef.Knowledge as Action,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.Tag:
                result = propertyIndex.AddTagPropertiesAsync(
                    semanticRef.Knowledge as Tag,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;

            case KnowledgeType.STag:
                result = propertyIndex.AddEntityPropertiesAsync(
                    semanticRef.Knowledge as StructuredTag,
                    semanticRef.SemanticRefOrdinal,
                    cancellationToken
                );
                break;
        }
        return result ?? Task.CompletedTask;
    }

    public static async Task AddSemanticRefsAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        IEnumerable<SemanticRef> semanticRefs,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRefs, nameof(semanticRefs));

        // TODO: Bulk operations
        foreach(var semanticRef in semanticRefs)
        {
            await propertyIndex.AddSemanticRefAsync(semanticRef, cancellationToken);
        }
    }

    public static async Task AddEntityPropertiesAsync(
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
            foreach (var facet in entity.Facets)
            {
                await propertyIndex.AddFacetAsync(facet, semanticRefOrdinal, cancellationToken).ConfigureAwait(false);
            }
        }

    }

    public static async Task AddFacetAsync(
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
                facet.Value.ToString(),
                semanticRefOrdinal,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    public static async Task AddActionPropertiesAsync(
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

    public static Task AddTagPropertiesAsync(
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
