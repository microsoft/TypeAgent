// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

internal class MetadataMerger
{
    HashSet<string> _source;
    HashSet<string> _dest;

    public MetadataMerger()
    {
        _source = [];
        _dest = [];
    }

    public (IList<string>?, IList<string>?) Collect(IMessageMetadata min, IMessageMetadata max)
    {
        Clear();

        if (!string.IsNullOrEmpty(min.Source))
        {
            _source.Add(min.Source);
        }
        if (!min.Dest.IsNullOrEmpty())
        {
            _dest.AddRange(min.Dest);
        }
        if (!string.IsNullOrEmpty(max.Source))
        {
            _source.Add(max.Source);
        }
        if (!max.Dest.IsNullOrEmpty())
        {
            _dest.AddRange(max.Dest);
        }
        return (_source.Count > 0 ? [.. _source] : null,
                _dest.Count > 0 ? [.. _dest] : null
        );
    }

    public void Clear()
    {
        _source.Clear();
        _dest.Clear();
    }
}
