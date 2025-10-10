// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class TextRangesInScope
{
    public TextRangesInScope(IList<TextRangeCollection>? textRanges = null)
    {
        TextRanges = textRanges;
    }

    public IList<TextRangeCollection>? TextRanges { get; private set; }

    public void AddTextRanges(TextRangeCollection ranges)
    {
        TextRanges ??= [];
        TextRanges.Add(ranges);
    }

    public bool IsRangeInScope(TextRange innerRange)
    {
        if (TextRanges is not null)
        {
            /**
                Since outerRanges come from a set of range selectors, they may overlap, or may not agree.
                Outer ranges allowed by say a date range selector... may not be allowed by a tag selector.
                We have a very simple impl: we don't intersect/union ranges yet.
                Instead, we ensure that the innerRange is not rejected by any outerRanges
             */
            foreach (var outerRanges in TextRanges)
            {
                if (!outerRanges.IsInRange(innerRange))
                {
                    return false;
                }
            }
        }
        return true;
    }
}
