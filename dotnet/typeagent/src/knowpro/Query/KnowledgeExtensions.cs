// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class KnowledgeExtensions
{
    public static bool MatchEntityNameOrType(this ConcreteEntity entity, SearchTerm searchTerm)
    {
        /*
        return (
            matchSearchTermToText(propertyValue, entity.name) ||
            matchSearchTermToOneOfText(propertyValue, entity.type)
        );
        */
        throw new NotImplementedException();
    }

}
