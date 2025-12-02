// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public static class SearchResultsExtensions
{
    public static async Task<IList<ConcreteEntity>> GetEntitiesAsync(this IDictionary<KnowledgeType, SemanticRefSearchResult> matches, ISemanticRefCollection semanticRefs)
    {
        List<ConcreteEntity> retVal = [];

        foreach (ScoredSemanticRefOrdinal semanticRef in matches[KnowledgeType.Entity].SemanticRefMatches)
        {
            retVal.Add((ConcreteEntity)(await semanticRefs.GetAsync(semanticRef.SemanticRefOrdinal, CancellationToken.None)).Knowledge);
        }

        return retVal;
    }

    public static async Task<bool> HasEntityMatchesWithNameAsync(this IDictionary<KnowledgeType, SemanticRefSearchResult> matches, string entityName, ISemanticRefCollection semanticRefs)
    {
        return await HasMatchesWithNameAsync(matches, entityName, KnowledgeType.Entity, semanticRefs);
    }

    public static async Task<bool> HasEntitiesAsync(this IDictionary<KnowledgeType, SemanticRefSearchResult> matches, IEnumerable<string> names, ISemanticRefCollection semanticRefs)
    {
        foreach(string name in names)
        {
            if (!await HasEntityMatchesWithNameAsync(matches, name, semanticRefs))
            {
                return false;
            }
        }

        return true;
    }

    public static async Task<bool> HasMatchesWithNameAsync(this IDictionary<KnowledgeType, SemanticRefSearchResult> matches, string entityName, KnowledgeType knowledgeType, ISemanticRefCollection semanticRefs)
    {
        foreach(var v in matches[knowledgeType].SemanticRefMatches)
        {
            SemanticRef? result = await semanticRefs.GetAsync(v.SemanticRefOrdinal, CancellationToken.None);
            if (result.Knowledge is ConcreteEntity entity)
            {
                if (entity.Name == entityName)
                {
                    return true;
                }
            }
        }

        return false;
    }
}
