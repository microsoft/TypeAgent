// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

public struct CompiledTermGroup
{
    public CompiledTermGroup(SearchTermBooleanOp booleanOp)
    {
        BooleanOp = booleanOp;
        Terms = [];
    }

    public SearchTermBooleanOp BooleanOp { get; }

    public IList<SearchTerm> Terms { get; set; }
}
