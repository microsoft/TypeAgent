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

    public Command Command_GetSize()
    {
        Command command = new Command("distribution");
        var pathOption = new Option<string>("--outPath", "Output path");
        command.AddOption(pathOption);
        command.SetHandler<string>((string outPath) =>
        {
            var (counter, histogram) = this.GetSizeDistribution();
            ConsoleEx.WriteLineColor(ConsoleColor.Green, $"{counter} items");
            string csv = PrintHistogram(histogram);
            if (!string.IsNullOrEmpty(outPath))
            {
                File.WriteAllText(outPath, csv);
            }
            Console.WriteLine(csv);
        }, pathOption);
        return command;
    }

    public (int, Dictionary<int, int>) GetSizeDistribution()
    {
        int cursor = Console.CursorLeft;
        Dictionary<int, int> histogram = new Dictionary<int, int>();

        int counter = 0;
        int totalLength = 0;
        foreach (int rawSize in _outlook.MapMailItems<int>((t) => t.BodyLatest().Length))
        {
            totalLength += rawSize;
            var bucket = GetBucketForSize(rawSize, SCALE);
            Console.CursorLeft = cursor;
            ++counter;
            Console.Write($"{counter}, {totalLength / 1024} K");

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
        Console.WriteLine();
        return (counter, histogram);
    }

    string PrintHistogram(Dictionary<int, int> histogram)
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

    public static int GetBucketForSize(int size, int interval)
    {
        while ((size / interval) != 0)
        {
            interval *= 2;
        }
        return interval;
    }
}
