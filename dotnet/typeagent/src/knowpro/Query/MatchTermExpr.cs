// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

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

    public Func<SearchTerm, SemanticRef,ScoredSemanticRefOrdinal, ScoredSemanticRefOrdinal>? ScoreBooster { get; set; }


    private async Task<IList<ScoredSemanticRefOrdinal>> LookupTermAsync(QueryEvalContext context, Term term)
    {
        var matches = await context.Conversation.SemanticRefIndex.LookupTermAsync(term.Text);

        if (matches.IsNullOrEmpty() && ScoreBooster is not null)
        {
            /*
            for (int i = 0; i < matches.Count; ++i)
            {
                matches[i] = ScoreBooster(
                    SearchTerm,
                    context.getSemanticRef(matches[i].semanticRefOrdinal),
                    matches[i],
                );
            }
            */
        }

        return matches;
    }
}
