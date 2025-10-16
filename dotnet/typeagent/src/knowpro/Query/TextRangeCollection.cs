// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class TextRangeCollection
{
    private List<TextRange> _ranges;

    public TextRangeCollection()
        : this([])
    {
    }

    public TextRangeCollection(List<TextRange> ranges)
    {
        ArgumentVerify.ThrowIfNull(ranges, nameof(ranges));
        _ranges = ranges;
    }

    public bool AddRange(TextRange textRange)
    {
        // TODO Future: merge ranges

        // Is this text range already in this collection?
        int pos = _ranges.BinarySearch(textRange);
        if (pos >= 0)
        {
            // Already exists
            return false;
        }
        _ranges.Insert(~pos, textRange);
        return true;
    }

    public bool IsInRange(TextRange rangeToMatch)
    {
        if (_ranges.Count == 0)
        {
            return false;
        }
        // Find the first text range with messageIndex == rangeToMatch.start.messageIndex
        int i = _ranges.BinarySearchFirst(
            rangeToMatch,
            (x, y) => x.Start.MessageOrdinal - y.Start.MessageOrdinal
        );
        if (i < 0)
        {
            return false;
        }
        if (i == _ranges.Count)
        {
            i--;
        }
        // Now loop over all text ranges that start at rangeToMatch.start.messageIndex
        int count = _ranges.Count;
        for (; i < count; ++i)
        {
            var range = _ranges[i];
            if (range.Start.MessageOrdinal > rangeToMatch.Start.MessageOrdinal)
            {
                break;
            }
            if (TextRange.IsInTextRange(range, rangeToMatch))
            {
                return true;
            }
        }
        return false;
    }

    public void Sort() => _ranges.Sort();

    public void Clear() => _ranges.Clear();
}
