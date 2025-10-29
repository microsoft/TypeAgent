// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TypeAgent.KnowPro;

public interface ITermToRelatedTermsFuzzy
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask AddTermsAsync(IList<string> texts, CancellationToken cancellationToken = default);

    ValueTask<IList<Term>> LookupTermAsync(string text, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default);

    ValueTask<IList<IList<Term>>> LookupTermAsync(IList<string> texts, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellation = default);

    event Action<Batch<string>> OnIndexed;
}

public static class TermToRelatedTermsFuzzyExtensions
{
    public static ValueTask<IList<Term>> LookupTermAsync(
        this ITermToRelatedTermsFuzzy index,
        string text,
        CancellationToken cancellationToken = default
    )
    {
        return index.LookupTermAsync(text, null, null, cancellationToken);
    }
}
