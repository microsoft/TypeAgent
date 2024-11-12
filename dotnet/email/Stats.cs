// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent;

internal class Stats
{
    public Stats()
    {
        Values = new List<int>();
        Total = 0;
    }

    public int Total { get; set; }
    public List<int> Values { get; set; }

    public int Median()
    {
        if (Values.Count == 0)
        {
            throw new NotSupportedException();
        }
        Values.Sort();
        return Values[Values.Count / 2];
    }

    public void Push(int value)
    {
        Total += value;
        Values.Add(value);
    }
}
