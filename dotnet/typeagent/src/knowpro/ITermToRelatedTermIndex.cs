// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToRelatedTermIndex
{
    ITermToRelatedTermsIndex Aliases { get; }

    ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
