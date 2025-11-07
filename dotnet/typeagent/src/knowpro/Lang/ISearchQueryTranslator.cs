// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public interface ISearchQueryTranslator
{
    ValueTask<SearchQuery> TranslateAsync(string request, IList<IPromptSection>? preamble = null, CancellationToken cancellationToken = default);
}
