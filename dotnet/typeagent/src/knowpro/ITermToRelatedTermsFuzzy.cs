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

    ValueTask AddTermsAsync(IList<string> texts);

    ValueTask<IList<Term>> LookupTermAsync(string text, int maxMatches, double minScore);

    ValueTask<IList<IList<Term>>> LookupTermAsync(IList<string> texts, int maxMatches, double minScore);
}
