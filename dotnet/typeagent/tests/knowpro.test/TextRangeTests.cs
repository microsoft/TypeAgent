// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public class TextRangeTests
{
    [Fact]
    public void TextRangeComparison()
    {
        TextRange tr = new TextRange(57);
        TextRange tr2 = new TextRange(57, 0);

        Assert.Equal(tr.ToString(), tr2.ToString());
        Assert.Equal(0, tr.CompareTo(tr2));
        Assert.Equal(0, TextRange.Compare(tr, tr2));

        TextRange trStartOnly = new TextRange(new TextLocation(33));
        TextRange trStartAndEnd = new TextRange(new TextLocation(33), new TextLocation(35));

        Assert.NotEqual(trStartOnly, trStartAndEnd);
        Assert.NotEqual(trStartOnly.ToString(), trStartAndEnd.ToString());
        Assert.Equal(1, trStartOnly.GetEnd().ChunkOrdinal);
        Assert.Equal(trStartAndEnd.End?.MessageOrdinal, trStartAndEnd.GetEnd().MessageOrdinal);
        Assert.Equal(trStartAndEnd.End?.ChunkOrdinal, trStartAndEnd.GetEnd().ChunkOrdinal);

        Assert.True(0 > TextRange.Compare(trStartOnly, trStartAndEnd));
        Assert.True(0 > TextRange.Compare(trStartOnly, new TextRange(100)));
    }

    [Fact]
    public void TestInvalidRange()
    {
        var ex = Assert.Throws<ArgumentException>(() => new TextRange(new TextLocation(20), new TextLocation(10)));
        Assert.Equal("Invalid text range", ex.Message);
    }

    [Fact]
    public void TestIsInTextRange()
    {
        Assert.True(TextRange.IsInTextRange(new TextRange(50), new TextRange(50)));
        Assert.False(TextRange.IsInTextRange(new TextRange(50), new TextRange(51)));
        Assert.False(TextRange.IsInTextRange(new TextRange(51), new TextRange(50)));

        Assert.True(TextRange.IsInTextRange(new TextRange(new TextLocation(50), new TextLocation(59)), new TextRange(51)));
        Assert.False(TextRange.IsInTextRange(new TextRange(50, 10), new TextRange(new TextLocation(51), new TextLocation(52))));
        Assert.True(TextRange.IsInTextRange(new TextRange(new TextLocation(50), new TextLocation(60)), new TextRange(new TextLocation(51), new TextLocation(52))));        

        // Text range is outside of text range
        Assert.False(TextRange.IsInTextRange(new TextRange(new TextLocation(50), new TextLocation(60)), new TextRange(new TextLocation(71), new TextLocation(72))));
        Assert.False(TextRange.IsInTextRange(new TextRange(new TextLocation(50), new TextLocation(60)), new TextRange(new TextLocation(71))));

        // Text range overlaps but exceeds range
        Assert.False(TextRange.IsInTextRange(new TextRange(new TextLocation(50), new TextLocation(60)), new TextRange(new TextLocation(51), new TextLocation(100))));
    }
}
