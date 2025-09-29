// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversationAPI
{
    public static async Task<IDictionary<KnowledgeType, SemanticRefSearchResult>?> SearchKnowledgeAsync(
        this IConversation conversation,
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter = null
    )
    {
        QueryCompiler compiler = new QueryCompiler(conversation);
        var query = await compiler.CompileKnowledgeQueryAsync(searchGroup, whenFilter);
        return null;
    }
}
