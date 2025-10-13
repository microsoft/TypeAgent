// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Query;

internal class MessageAccumulator : MatchAccumulator<int>
{
    public MessageAccumulator(IEnumerable<Match<int>> matches = null)
        : base()
    {
        if (matches is not null)
        {
            SetMatches(matches);
        }
    }

    public void Add(int value, double score)
    {
        var match = this[value];
        if (match is null)
        {
            match = new Match<int>(value, score, 1);
            SetMatch(match);
        }
        else if (score > match.Score)
        {
            match.Score = score;
            match.HitCount++;
        }
    }

    public void AddFromLocations(
        IEnumerable<ScoredTextLocation> scoredTextLocations
    )
    {
        ArgumentVerify.ThrowIfNull(scoredTextLocations, nameof(scoredTextLocations));

        foreach (var sl in scoredTextLocations)
        {
            Add(sl.TextLocation.MessageOrdinal, sl.Score);
        }
    }


    public void AddForSemanticRef(SemanticRef semanticRef, double score)
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));

        var messageOrdinalStart = semanticRef.Range.Start.MessageOrdinal;
        if (semanticRef.Range.End is not null)
        {
            var messageOrdinalEnd = semanticRef.Range.End.Value.MessageOrdinal;
            for (int messageOrdinal = messageOrdinalStart; messageOrdinal < messageOrdinalEnd; ++messageOrdinal)
            {
                Add(messageOrdinal, score);
            }
        }
        else
        {
            Add(messageOrdinalStart, score);
        }
    }

    public void AddRange(TextRange range, double score)
    {
        ArgumentVerify.ThrowIfNull(range, nameof(range));

        Add(range.Start.MessageOrdinal, score);
        if (range.End is not null)
        {
            var ordinal = range.Start.MessageOrdinal + 1;
            var endOrdinal = range.End.Value.MessageOrdinal;
            for (; ordinal < endOrdinal; ++ordinal)
            {
                Add(ordinal, score);
            }
        }
    }

    public void AddScoredMatches(IEnumerable<ScoredMessageOrdinal> matches)
    {
        foreach (var match in matches)
        {
            Add(match.MessageOrdinal, match.Score);
        }
    }

    public MessageAccumulator Intersect(MessageAccumulator other)
    {
        var intersection = new MessageAccumulator();
        base.Intersect(other, intersection);
        return intersection;
    }


    public IList<ScoredMessageOrdinal> ToScoredMessageOrdinals()
    {
        return GetSortedByScore(0).Map((m) =>
        {
            return new ScoredMessageOrdinal()
            {
                MessageOrdinal = m.Value,
                Score = m.Score
            };
        });
    }


}
