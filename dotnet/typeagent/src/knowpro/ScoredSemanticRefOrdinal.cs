// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct ScoredSemanticRefOrdinal
{
    public int SemanticRefOrdinal { get; set; }

    public float Score { get; set; }

    public static ScoredSemanticRefOrdinal New(int semanticRefOrdinal)
    {
        return new ScoredSemanticRefOrdinal { SemanticRefOrdinal = semanticRefOrdinal, Score = 1 };
    }

    public static IList<int> ToSemanticRefOrdinals(IList<ScoredSemanticRefOrdinal>? items)
    {
        return items is not null ?
               items.Map((s) => s.SemanticRefOrdinal) :
               [];
    }
}
