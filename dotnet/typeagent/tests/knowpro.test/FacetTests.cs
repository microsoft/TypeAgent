// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;
public class FacetTests
{
    [Fact]
    public void MatchTest()
    {
        Facet f1 = new Facet()
        {
            Name = "Foo",
            Value = new StringFacetValue("bar")
        };

        Facet f2 = new Facet()
        {
            Name = "Bar",
            Value = new StringFacetValue("bar")
        };

        Assert.True(f1.Match(f1));
        Assert.False(f1.Match(f2));

        Facet f3 = new Facet()
        {
            Name = "Length",
            Value = new Quantity(100, "feet")
        };

        Facet f4 = new Facet()
        {
            Name = "Length",
            Value = new Quantity(100, "feet")
        };

        Assert.True(f3.Match(f4));

        Facet f5 = new Facet()
        {
            Name = "income",
            Value = new Quantifier("millions", "dollar")
        };

        Facet f6 = new Facet()
        {
            Name = "income",
            Value = new Quantifier("millions", "dollar")
        };

        Assert.True(f3.Match(f4));
    }

    [Fact]
    public void TestSerialization()
    {
        string quantifier_json = /*lang=json*/ @"
        {
            ""amount"": ""millions"",
            ""units"": ""dollars""
        }
        ";


        Quantifier? f = JsonSerializer.Deserialize<Quantifier>(quantifier_json);

        Assert.NotNull(f);

        string txt = JsonSerializer.Serialize(f);
        Assert.Equal(quantifier_json.Replace("\n", "").Replace(" ", ""), txt);

        string quantity_json = /*lang=json*/ @"
        {
            ""amount"": 100,
            ""units"": ""feet""
        }
        ";


        Quantity? qf = JsonSerializer.Deserialize<Quantity>(quantity_json);

        Assert.NotNull(qf);

        txt = JsonSerializer.Serialize(qf);
        Assert.Equal(quantity_json.Replace("\n", "").Replace(" ", ""), txt);

    }
}
