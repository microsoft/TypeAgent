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

    public SearchQueryTranslator(ILanguageModel languageModel)
        : this(
              languageModel,
              SchemaLoader.LoadResource(typeof(SearchQuery).Assembly, "TypeAgent.KnowPro.Lang.searchQuerySchema.ts")
        )
    {

    }

    public SearchQueryTranslator(ILanguageModel languageModel, string schema)
    {
        _translator = new JsonTranslator<SearchQuery>(
            languageModel,
            new SchemaText(schema, SchemaText.Languages.Typescript)
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
