// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public interface ISearchQueryTranslator
{
    ValueTask<SearchQuery> TranslateAsync(
        string request,
        IList<IPromptSection>? preamble = null,
        CancellationToken cancellationToken = default
    );
}

public class SearchQueryTranslator : ISearchQueryTranslator
{
    JsonTranslator<SearchQuery> _translator;

    public SearchQueryTranslator(IChatModel model)
    {
        _translator = JsonTranslatorFactory.CreateTranslator<SearchQuery>(
            model,
            "TypeAgent.KnowPro.Lang.searchQuerySchema.ts"
        );
    }

    public async ValueTask<SearchQuery> TranslateAsync(
        string request,
        IList<IPromptSection>? preamble = null,
        CancellationToken cancellationToken = default
    )
    {
        return await _translator.TranslateAsync(request, preamble, null, cancellationToken);
    }
}
