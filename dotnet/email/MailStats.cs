// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;

namespace TypeAgent;

public class MailStats
{
    Outlook _outlook;

    public MailStats(Outlook outlook)
    {
        ArgumentNullException.ThrowIfNull(outlook);
        _outlook = outlook;
    }

    public Command Command_GetSize()
    {
        Command command = new Command("GetSizes");
        command.SetHandler(() =>
        {
            var (counter, histogram) = this.GetSizeDistribution();
            ConsoleEx.WriteLineColor(ConsoleColor.Green, $"{counter} items");
            PrintHistogram(histogram);
        });
        return command;
    }

    public (int, Dictionary<int, int>) GetSizeDistribution()
    {
        int cursor = Console.CursorLeft;
        Dictionary<int, int> histogram = new Dictionary<int, int>();
        int counter = 0;
        int totalLength = 0;
        foreach(int rawSize in _outlook.MapMailItems<int>((t) => t.Body.Length))
        {
            totalLength += rawSize;
            int sizeK = rawSize / 1024;
            if (sizeK < 0)
            {
                sizeK = 1;
            }

            Console.CursorLeft = cursor;
            ++counter;
            Console.Write($"{counter}, {totalLength / 1024} K");

            if (histogram.TryGetValue(sizeK, out int count))
            {
                count++;
                histogram[sizeK] = count;
            }
            else
            {
                histogram[sizeK] = 1;
            }
        }
        return (counter, histogram);
    }

    void PrintHistogram(Dictionary<int, int> histogram)
    {
        var table = histogram.ToArray();
        ConsoleEx.WriteLineColor(ConsoleColor.Cyan, $"{histogram.Count} sizes");
        Array.Sort(table, (KeyValuePair<int, int> x, KeyValuePair<int, int> y) => x.Key - y.Key);
        for (int i = 0; i < table.Length; ++i)
        {
            Console.WriteLine($"{i}\t{table[i].Key},\t{table[i].Value}");
        }
    }
}
