// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro.Lang;

public class LangSearchDebugContext
{
    // Query returned by the LLM
    public SearchQuery? SearchQuery { get; set; }

    // Compiled query expressions
    public List<SearchQueryExpr>? SearchQueryExpr { get; set; }

    // Indicates per expression whether similarity fallback was used
    public List<bool>? UsedSimilarityFallback { get; set; }
}
