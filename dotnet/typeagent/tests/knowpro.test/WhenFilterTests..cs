// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;
public class WhenFilterTests
{
    [Fact]
    public void ToStringTest()
    {
        WhenFilter when = new()
        {
            KnowledgeType = KnowledgeType.Tag,
            DateRange = new(),
            Tags = ["tag1", "tag2", "tag3"],
            TagMatchingTerms = new SearchTermGroup(SearchTermBooleanOp.Or),
            ScopeDefiningTerms = new SearchTermGroup(SearchTermBooleanOp.And),
            TextRangesInScope = [],
            ThreadDescription = "Description"
        };

        Assert.False(string.IsNullOrEmpty(when.ToString()));
    }
}
