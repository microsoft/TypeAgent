// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using UiAutomationHelper.Models;
using UiAutomationHelper.Uia;
using Xunit;

namespace UiAutomationHelper.Tests;

public class SelectorParserTests
{
    [Fact]
    public void Parse_SingleWindow_NoPredicates()
    {
        var p = SelectorParser.Parse("/Window");
        Assert.Single(p.Segments);
        var s = p.Segments[0];
        Assert.Equal("Window", s.ControlType);
        Assert.Null(s.Name);
        Assert.Null(s.AutomationId);
        Assert.Null(s.ClassName);
        Assert.Null(s.Index);
    }

    [Fact]
    public void Parse_NamePredicate()
    {
        var p = SelectorParser.Parse("/Window[Name=\"Clock\"]");
        Assert.Equal("Clock", p.Segments[0].Name);
    }

    [Fact]
    public void Parse_AutomationIdPredicate()
    {
        var p = SelectorParser.Parse("/Button[AutomationId=\"StartButton\"]");
        Assert.Equal("StartButton", p.Segments[0].AutomationId);
    }

    [Fact]
    public void Parse_ClassNamePredicate()
    {
        var p = SelectorParser.Parse("/Pane[ClassName=\"Microsoft.UI.Xaml.Controls.PaneRoot\"]");
        Assert.Equal("Microsoft.UI.Xaml.Controls.PaneRoot", p.Segments[0].ClassName);
    }

    [Fact]
    public void Parse_IndexPredicate()
    {
        var p = SelectorParser.Parse("/ListItem[3]");
        Assert.Equal(3, p.Segments[0].Index);
    }

    [Fact]
    public void Parse_MultiplePredicates()
    {
        var p = SelectorParser.Parse("/Button[Name=\"Save\"][AutomationId=\"SaveBtn\"]");
        Assert.Equal("Save", p.Segments[0].Name);
        Assert.Equal("SaveBtn", p.Segments[0].AutomationId);
    }

    [Fact]
    public void Parse_DeepPath()
    {
        var p = SelectorParser.Parse(
            "/Window[Name=\"Clock\"]/Pane/Pivot/PivotItem[Name=\"Timer\"]/Button[AutomationId=\"StartButton\"]");
        Assert.Equal(5, p.Segments.Count);
        Assert.Equal("Window", p.Segments[0].ControlType);
        Assert.Equal("Clock", p.Segments[0].Name);
        Assert.Equal("Pane", p.Segments[1].ControlType);
        Assert.Equal("Pivot", p.Segments[2].ControlType);
        Assert.Equal("Timer", p.Segments[3].Name);
        Assert.Equal("StartButton", p.Segments[4].AutomationId);
    }

    [Fact]
    public void Parse_EscapedQuoteInValue()
    {
        var p = SelectorParser.Parse("/Edit[Name=\"It\\\"s mine\"]");
        Assert.Equal("It\"s mine", p.Segments[0].Name);
    }

    [Fact]
    public void Parse_EscapedBackslashInValue()
    {
        var p = SelectorParser.Parse("/Edit[Name=\"path\\\\to\\\\file\"]");
        Assert.Equal("path\\to\\file", p.Segments[0].Name);
    }

    [Fact]
    public void Parse_EmptyStringValue()
    {
        var p = SelectorParser.Parse("/Edit[Name=\"\"]");
        Assert.Equal("", p.Segments[0].Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("Window")]               // missing leading slash
    [InlineData("/")]                    // empty segment
    [InlineData("/Window[Name=Clock]")] // unquoted value
    [InlineData("/Window[Name=\"Clock\"")] // unterminated bracket
    [InlineData("/Window[Bogus=\"x\"]")]  // unknown predicate key
    [InlineData("/123Window")]            // identifier starting with digit
    public void Parse_InvalidInputs_Throw(string input)
    {
        Assert.Throws<FormatException>(() => SelectorParser.Parse(input));
    }

    [Fact]
    public void Format_RoundTrip()
    {
        var input = "/Window[AutomationId=\"win1\"][Name=\"Clock\"]/Button[AutomationId=\"StartButton\"]";
        var path = SelectorParser.Parse(input);
        var formatted = SelectorParser.Format(path);
        var reparsed = SelectorParser.Parse(formatted);
        Assert.Equal(path.Segments.Count, reparsed.Segments.Count);
        for (int i = 0; i < path.Segments.Count; i++)
        {
            Assert.Equal(path.Segments[i], reparsed.Segments[i]);
        }
    }

    [Fact]
    public void Format_PutsAutomationIdFirst()
    {
        var seg = new SelectorSegment("Button", Name: "X", AutomationId: "Y");
        var formatted = SelectorParser.FormatSegment(seg);
        Assert.Equal("/Button[AutomationId=\"Y\"][Name=\"X\"]", formatted);
    }

    [Fact]
    public void Format_EscapesQuotes()
    {
        var seg = new SelectorSegment("Edit", Name: "He said \"hi\"");
        var formatted = SelectorParser.FormatSegment(seg);
        Assert.Equal("/Edit[Name=\"He said \\\"hi\\\"\"]", formatted);
    }
}
