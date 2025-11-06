// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class SearchQueryTranslator : ISearchQueryTranslator
{
    JsonTranslator<SearchQuery> _translator;

    public SearchQueryTranslator(IChatModel model)
    {
        ArgumentVerify.ThrowIfNull(model, nameof(model));

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
        return await _translator.TranslateAsync(
            request,
            preamble,
            null,
            cancellationToken
        ).ConfigureAwait(false);
    }
}
