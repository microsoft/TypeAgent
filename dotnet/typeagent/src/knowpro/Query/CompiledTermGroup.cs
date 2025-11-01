// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal struct CompiledTermGroup
{
    public CompiledTermGroup(SearchTermBooleanOp booleanOp)
    {
        BooleanOp = booleanOp;
        Terms = [];
    }

    public SearchTermBooleanOp BooleanOp { get; }

    public List<SearchTerm> Terms { get; set; }
}
