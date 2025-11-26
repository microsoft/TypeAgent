// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.TestLib;

public static class Extensions
{
    public static IEnumerable<string> ReadLines(this string text)
    {
        using var reader = new StringReader(text);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            yield return line;
        }
    }

    public static List<string> Lines(this string text)
    {
        return [.. text.ReadLines()];
    }

    public static bool ContainsSubstring(this IEnumerable<string> lines, params string[] subStrings)
    {
        foreach (var line in lines)
        {
            if (line.Contains(subStrings))
            {
                return true;
            }
        }
        return false;
    }

    public static bool Contains(this string text, params string[] subStrings)
    {
        for (int i = 0; i < subStrings.Length; ++i)
        {
            if (!text.Contains(subStrings[i]))
            {
                return false;
            }
        }
        return true;
    }

    //public static JsonTranslator<T> CreateTranslator<T>(this Config config)
    //{
    //    return new JsonTranslator<T>(
    //        new ChatLanguageModel(config.OpenAI),
    //        new TypeValidator<T>(TestVocabs.All()));
    //}

    /// <summary>
    /// Generate an array of random floats
    /// </summary>
    public static float[] FloatArray(this Random random, int count)
    {
        float[] array = new float[count];
        for (int i = 0; i < count; ++i)
        {
            array[i] = random.NextSingle();
        }

        return array;
    }


    public static int RoundToInt(this double value)
    {
        return (int)(value + 0.5);
    }

    public static HttpResponseMessage SetJson(this HttpResponseMessage message, string json)
    {
        message.Content = new StringContent(json, null, "application/json");
        return message;
    }
}
