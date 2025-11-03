// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public interface IMemory
{
    ValueTask<IList<ConversationSearchResult>> SearchAsync(
        string searchText,
        LangSearchOptions? options = null,
        LangSearchFilter? filter = null,
        LangSearchDebugContext? debugContext = null,
        CancellationToken cancellationToken = default
    );
}
