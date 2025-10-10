// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal delegate ScoredSemanticRefOrdinal ScoreBooster(
    SemanticRef semanticRef,
    ScoredSemanticRefOrdinal scoredOrdinal
);

internal class MatchTermExpr : QueryOpExpr<SemanticRefAccumulator?>
{
    public MatchTermExpr()
        : base()
    {
    }

    public override async ValueTask<SemanticRefAccumulator?> EvalAsync(QueryEvalContext context)
    {
        var matches = new SemanticRefAccumulator();
        await AccumulateMatchesAsync(context, matches).ConfigureAwait(false);
        return matches.Count > 0 ? matches : null;
    }

    protected virtual ValueTask AccumulateMatchesAsync(
        QueryEvalContext context,
        SemanticRefAccumulator matches
    )
    {
        return ValueTask.CompletedTask;
    }

}

internal class MatchSearchTermExpr : MatchTermExpr
{
    public MatchSearchTermExpr(SearchTerm searchTerm, ScoreBooster? scoreBooster = null)
    {
        ArgumentVerify.ThrowIfNull(searchTerm, nameof(searchTerm));
        SearchTerm = searchTerm;
        ScoreBooster = scoreBooster;
    }

    public SearchTerm SearchTerm { get; }

    public ScoreBooster? ScoreBooster { get; }

    protected override async ValueTask AccumulateMatchesAsync(
        QueryEvalContext context,
        SemanticRefAccumulator matches
    )
    {
        // Match the search term
        await AccumulateMatchesAsync(context, matches, SearchTerm.Term).ConfigureAwait(false);
        // And any related terms
        if (!SearchTerm.RelatedTerms.IsNullOrEmpty())
        {
            foreach (var relatedTerm in SearchTerm.RelatedTerms)
            {
                await AccumulateMatchesAsync(
                    context,
                    matches,
                    SearchTerm.Term,
                    relatedTerm
                ).ConfigureAwait(false);
            }
        }
    }

    private async ValueTask AccumulateMatchesAsync(
        QueryEvalContext context,
        SemanticRefAccumulator matches,
        Term term
    )
    {
        if (context.MatchedTerms.Has(term))
        {
            return;
        }
        var semanticRefs = await LookupTermAsync(context, term).ConfigureAwait(false);
        if (!semanticRefs.IsNullOrEmpty())
        {
            matches.AddTermMatches(term, semanticRefs, true);
            context.MatchedTerms.Add(term);
        }
    }

    private async ValueTask AccumulateMatchesAsync(
        QueryEvalContext context,
        SemanticRefAccumulator matches,
        Term term,
        Term relatedTerm
    )
    {
        if (context.MatchedTerms.Has(relatedTerm))
        {
            return;
        }

        // If this related term had not already matched as a related term for some other term
        // Minimize over counting
        var semanticRefs = await LookupTermAsync(context, relatedTerm).ConfigureAwait(false);
        if (!semanticRefs.IsNullOrEmpty())
        {
            // This will only consider semantic refs that have not already matched this expression. In other words, if a semantic
            // ref already matched due to the term 'novel', don't also match it because it matched the related term 'book'
            matches.AddTermMatchesIfNew(
                term,
                semanticRefs,
                false,
                relatedTerm.Weight
            );
            context.MatchedTerms.Add(relatedTerm);
        }
    }

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

internal class MatchPropertySearchTermExpr : MatchTermExpr
{
    public MatchPropertySearchTermExpr(PropertySearchTerm propertyTerm)
    {
        ArgumentVerify.ThrowIfNull(propertyTerm, nameof(propertyTerm));
        PropertySearchTerm = propertyTerm;
    }

    public PropertySearchTerm PropertySearchTerm { get; }

    protected override ValueTask AccumulateMatchesAsync(QueryEvalContext context, SemanticRefAccumulator matches)
    {
        if (PropertySearchTerm.PropertyName is KnowledgePropertyNameSearchTerm stringName)
        {
            return AccumulateMatchesForPropertyAsync(
                context,
                stringName,
                PropertySearchTerm.PropertyValue,
                matches
            );
        }
        else if (PropertySearchTerm.PropertyName is PropertyNameSearchTerm fullName)
        {
            return AccumulateMatchesForFacetsAsync(
                context,
                fullName,
                PropertySearchTerm.PropertyValue,
                matches
            );
        }
        return ValueTask.CompletedTask;
    }

    private ValueTask AccumulateMatchesForPropertyAsync(
        QueryEvalContext context,
        string propertyName,
        SearchTerm propertyValue,
        SemanticRefAccumulator matches
    )
    {
        throw new NotImplementedException();
    }

    private async ValueTask AccumulateMatchesForFacetsAsync(
        QueryEvalContext context,
        SearchTerm propertyName,
        SearchTerm propertyValue,
        SemanticRefAccumulator matches
    )
    {
        // Assuming PropertyNames.FacetName and PropertyNames.FacetValue are of type KnowledgePropertyName
        await AccumulateMatchesForPropertyAsync(
            context,
            KnowledgePropertyName.FacetName,
            propertyName,
            matches
        ).ConfigureAwait(false);

        // Assuming isSearchTermWildcard is a method that checks if the SearchTerm is a wildcard
        if (!propertyValue.IsWildcard())
        {
            await AccumulateMatchesForPropertyAsync(
                context,
                KnowledgePropertyName.FacetValue,
                propertyValue,
                matches
            ).ConfigureAwait(false);
        }
    }

    private ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupPropertyAsync(
        QueryEvalContext context,
        string propertyName,
        string propertyValue
    )
    {
        return context.PropertyIndex.LookupPropertyAsync(
            context,
            propertyName,
            propertyValue,
            context.TextRangesInScope
        );
    }
}
