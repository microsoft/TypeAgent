// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text;

namespace Microsoft.TypeChat.Tests;

public class StringExTests
{
    [Fact]
    public void ExtractLine_ReturnsCorrectLines()
    {
        // Arrange
        string text = "Line1\nLine2\nLine3\nLine4\nLine5";
        var sb = new StringBuilder();

        // Act
        text.ExtractLine(2, sb);

        // Assert
        var expected = "Line2\r\nLine3\r\nLine4\r\n";
        Assert.Equal(expected, sb.ToString());
    }

    [Fact]
    public void ExtractLine_HandlesFirstLine()
    {
        string text = "A\nB\nC";
        var sb = new StringBuilder();

        text.ExtractLine(0, sb);

        var expected = "A\r\nB\r\n";
        Assert.Equal(expected, sb.ToString());
    }

    [Fact]
    public void AppendLineNotEmpty_AppendsNonEmptyLine()
    {
        var sb = new StringBuilder();
        sb.AppendLineNotEmpty("Test");

        Assert.Equal("Test\r\n", sb.ToString());
    }

    [Fact]
    public void AppendLineNotEmpty_DoesNotAppendEmptyLine()
    {
        var sb = new StringBuilder();
        sb.AppendLineNotEmpty("");
        sb.AppendLineNotEmpty(null);

        Assert.Equal(string.Empty, sb.ToString());
    }

    [Fact]
    public void TrimAndAppendLine_TrimsAndAppends()
    {
        var sb = new StringBuilder();
        sb.TrimAndAppendLine("  Hello World  ");

        Assert.Equal("Hello World\r\n", sb.ToString());
    }

    [Fact]
    public void AppendMultiple_AppendsWithSeparator()
    {
        var sb = new StringBuilder();
        var items = new List<string> { "A", "B", "C" };

        sb.AppendMultiple(",", items);

        Assert.Equal("A,B,C", sb.ToString());
    }

    [Fact]
    public void AppendMultiple_EmptyList()
    {
        var sb = new StringBuilder();
        var items = new List<string>();

        sb.AppendMultiple(",", items);

        Assert.Equal(string.Empty, sb.ToString());
    }
}
