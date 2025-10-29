// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class RelatedTermsExtensions
{
    public static async ValueTask ResolveRelatedTermsAsync(
        this ITermToRelatedTermIndex relatedTermIndex,
        List<Query.CompiledTermGroup> compiledTerms,
        bool ensureSingleOccurence,
        CancellationToken cancellationToken = default
    )
    {
        List<SearchTerm> termsNeedingRelated = SelectTermsNeedingRelated(compiledTerms);
        if (termsNeedingRelated.IsNullOrEmpty())
        {
            return;
        }

        List<string> termTexts = termsNeedingRelated.Map((st) => st.Term.Text);
        // First, find an known related terms
        var knownRelatedTerms = await relatedTermIndex.Aliases.LookupTermAsync(
            termTexts,
            cancellationToken
        ).ConfigureAwait(false);

        if (!knownRelatedTerms.IsNullOrEmpty())
        {
            for (int i = 0; i < termsNeedingRelated.Count;)
            {
                if (knownRelatedTerms.TryGetValue(termTexts[i], out var relatedTerms))
                {
                    termsNeedingRelated[i].RelatedTerms = relatedTerms;
                    termTexts.RemoveAt(i);
                    termsNeedingRelated.RemoveAt(i);
                    continue;
                }
                else
                {
                    ++i;
                }
            }
        }
        // Anything that did not have known related terms... will get terms that are fuzzily related
        if (termsNeedingRelated.IsNullOrEmpty())
        {
            return;
        }
        var relatedTermsFuzzy = await relatedTermIndex.FuzzyIndex.LookupTermAsync(
            termTexts,
            null,
            null,
            cancellationToken
        );
        for (int i = 0; i < termsNeedingRelated.Count; ++i)
        {
            termsNeedingRelated[i].RelatedTerms = relatedTermsFuzzy[i];
        }
        // TODO: Dedupe
    }

    internal static List<SearchTerm>? SelectTermsNeedingRelated(List<Query.CompiledTermGroup> compiledTerms)
    {
        List<SearchTerm> searchTerms = [];
        foreach (var compiledTerm in compiledTerms)
        {
            foreach (var searchTerm in compiledTerm.Terms)
            {
                if (!(searchTerm.IsWildcard() || searchTerm.IsExactMatch()))
                {
                    searchTerms.Add(searchTerm);
                }
            }
        }
        return searchTerms;
    }

}
