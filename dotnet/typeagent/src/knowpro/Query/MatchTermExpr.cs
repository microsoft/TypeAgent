// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal delegate ScoredSemanticRefOrdinal ScoreBooster(
    Term term,
    SemanticRef semanticRef,
    ScoredSemanticRefOrdinal scoredOrdinal
    );

internal class MatchTermExpr : QueryOpExprAsync<SemanticRefAccumulator?>
{
    public MatchTermExpr()
        : base()
    {
    }
}

internal class MatchSearchTermExpr : MatchTermExpr
{
    public MatchSearchTermExpr(SearchTerm searchTerm)
    {
        ArgumentVerify.ThrowIfNull(searchTerm, nameof(searchTerm));
        SearchTerm = searchTerm;
    }

    public SearchTerm SearchTerm { get; private set; }

    public ScoreBooster? ScoreBooster { get; set; }

    private ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(QueryEvalContext context, Term term)
    {
        return context.SemanticRefIndex.LookupTermAsync(
            context,
            term,
            context.TextRangesInScope,
            null,
            ScoreBooster
        );
    }
}
