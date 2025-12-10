// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.Tests.KnowPro;

public class SearchGroupTest
{
    [Fact]
    public void SearchTermGroupTest()
    {
        var stg = new SearchTermGroup(SearchTermBooleanOp.And, null);
        var bookTerm = new SearchTerm("book");
        bookTerm.RelatedTerms = [new Term("novel"), new Term("fiction")];

        stg.Terms.Add(new SearchTerm("book"));
        stg.Terms.Add(new SearchTerm("movie"));

        PropertySearchTerm pst = new PropertySearchTerm("type", "book");
        stg.Terms.Add(pst);

        var nestedGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax, null);
        var bicycleTerm = new SearchTerm("bicycle");
        bicycleTerm.RelatedTerms = [new Term("bike"), new Term("cycle")];
        nestedGroup.Terms.Add(bicycleTerm);
        nestedGroup.Terms.Add(new PropertySearchTerm("type", "album"));
        stg.Terms.Add(nestedGroup);
    }

    [Fact]
    public void EmptySearchTermGroupTest()
    {
        var stg = new SearchTermGroup(SearchTermBooleanOp.And, null);
        Assert.True(stg.IsEmpty);
        stg.Add("test");
        Assert.False(stg.IsEmpty);
    }

    [Fact]
    public void AddSearchTermTest()
    {
        var stg = new SearchTermGroup(SearchTermBooleanOp.Or, null)
        {
            { "example", true }
        };

        Assert.Single(stg.Terms);
        stg.Optimize();

        stg.Add(["sample1", "sample2"], false);
        stg.Add(new PropertySearchTerm("category", new SearchTerm("test", true)));

        Assert.Equal(4, stg.Terms.Count);

        Assert.Throws<ArgumentNullException>(() => stg.Add((ISearchTerm)null!));

        stg.Add(KnowledgePropertyName.Topic, "science", true);
        Assert.Equal(5, stg.Terms.Count);

        stg.Add(KnowledgePropertyName.Topic, ["cartoon","comic"], true);
        Assert.Equal(7, stg.Terms.Count);

        stg.Add("author", "John Doe");
        Assert.Equal(8, stg.Terms.Count);

        Assert.True(stg.ToString().Length > 0);

        stg.Optimize();

        int i = 0;
        foreach (var term in stg)
        {
            i++;
        }

        Assert.Equal(i, stg.Terms.Count);

        int j = 0;
        IEnumerator e = ((IEnumerable)stg).GetEnumerator();
        while (e.MoveNext())
        {
            j++;
        }

        Assert.Equal(j, stg.Terms.Count);
    }
}
