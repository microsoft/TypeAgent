// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToRelatedTermIndex
{
    ITermsToRelatedTermsIndex Aliases { get; }

    ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
