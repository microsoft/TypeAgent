// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Helper methods for loading vocabularies from a Json files and streams
/// The file is a dictionary of json properties like this:
/// {
/// "coffeeDrink": ["americano", "coffee"],
/// "toppings": ["cinnamon", "almond", "vanilla"]
/// }
/// </summary>
public class VocabFile
{
    /// <summary>
    /// Load a vocabulary from a JSON file
    /// </summary>
    /// <param name="filePath"></param>
    /// <returns></returns>
    public static VocabCollection Load(string filePath)
    {
        using Stream stream = File.OpenRead(filePath);
        var records = JsonSerializer.Deserialize<Dictionary<string, string[]>>(stream);
        VocabCollection vocabs = new VocabCollection();
        Add(vocabs, records);
        return vocabs;
    }

    /// <summary>
    /// Load a vocabulary from a json file
    /// </summary>
    /// <param name="filePath"></param>
    /// <returns></returns>
    public static async Task<VocabCollection> LoadAsync(string filePath)
    {
        using Stream stream = File.OpenRead(filePath);
        return await LoadAsync(stream).ConfigureAwait(false);
    }

    /// <summary>
    /// Load a vocabulary from the given stream
    /// </summary>
    /// <param name="stream"></param>
    /// <returns></returns>
    public static async Task<VocabCollection> LoadAsync(Stream stream)
    {
        ArgumentVerify.ThrowIfNull(stream, nameof(stream));

        var records = await JsonSerializer.DeserializeAsync<Dictionary<string, string[]>>(stream).ConfigureAwait(false);
        VocabCollection vocabs = new VocabCollection();
        Add(vocabs, records);
        return vocabs;
    }

    private static void Add(VocabCollection vocabs, IDictionary<string, string[]> vocabRecords)
    {
        ArgumentVerify.ThrowIfNull(vocabRecords, nameof(vocabRecords));
        foreach (var record in vocabRecords)
        {
            var vocab = new Vocab(record.Value);
            vocab.TrimExcess();
            vocabs.Add(record.Key, vocab);
        }
    }
}
