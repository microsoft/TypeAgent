// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class MailStats
{
    const int SCALE = 1024;

    Outlook _outlook;

    public MailStats(Outlook outlook)
    {
        ArgumentNullException.ThrowIfNull(outlook);
        _outlook = outlook;
    }

    public (int, Dictionary<int, int>) GetSizeDistribution(OlSensitivity sensitivity = OlSensitivity.olNormal)
    {
        int cursor = Console.CursorLeft;
        Dictionary<int, int> histogram = new Dictionary<int, int>();

        Stats skipped = new Stats();
        Stats stats = new Stats();
        foreach (MailItem item in _outlook.ForEachMailItem(sensitivity))
        {
            if (item.IsForward())
            {
                var body = item.Body;
                skipped.Push(body.Length);
            }
            else
            {
                int rawSize = item.BodyLatest().Length;
                stats.Push(rawSize);
                var bucket = GetBucketForSize(rawSize, SCALE);
                if (histogram.TryGetValue(bucket, out int count))
                {
                    count++;
                    histogram[bucket] = count;
                }
                else
                {
                    histogram[bucket] = 1;
                }
            }
            Console.CursorLeft = cursor;
            Console.Write($"{stats.Values.Count}, {stats.Total / 1024} K");
            if (skipped.Values.Count > 0)
            {
                Console.Write($" [FW: skipped {skipped.Values.Count}, {skipped.Total / 1024} K]");
            }
        }
        Console.WriteLine();
        if (stats.Values.Count > 0)
        {
            double median = ((double) stats.Median()) / 1024;
            ConsoleEx.WriteLineColor(ConsoleColor.Cyan, $"Median: {Math.Round(median, 2)} K, Average: {stats.Values.Average() / 1024} K");
        }
        return (stats.Values.Count, histogram);
    }

    public static string PrintHistogram(Dictionary<int, int> histogram)
    {
        StringBuilder sb = new StringBuilder();
        var table = histogram.ToArray();
        Array.Sort(table, (KeyValuePair<int, int> x, KeyValuePair<int, int> y) => x.Key - y.Key);
        sb.AppendLine("Size K, Count");
        for (int i = 0; i < table.Length; ++i)
        {
            sb.AppendLine($"{table[i].Key},{table[i].Value}");
        }
        return sb.ToString();
    }

    public static int GetBucketForSize(int size, int interval = SCALE)
    {
        while ((size / interval) != 0)
        {
            interval *= 2;
        }
        return interval;
    }
}
