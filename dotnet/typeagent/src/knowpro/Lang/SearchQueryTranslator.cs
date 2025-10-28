// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class SearchQueryTranslator
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

    public async ValueTask<SearchQuery> TranslateAsync(string request, CancellationToken cancellationToken)
    {
        return await _translator.TranslateAsync(request, cancellationToken);
    }
}
