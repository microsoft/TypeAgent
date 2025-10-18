// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Language Model Information
/// </summary>
public class ModelInfo
{
    private readonly string _name;
    private readonly int _maxTokens;
    private readonly int _maxCharCount;
    private readonly double _tokenToCharMultiple;

    /// <summary>
    /// Create model information
    /// </summary>
    /// <param name="name">Name of the model</param>
    /// <param name="maxTokens">Token limit - default is 4096</param>
    /// <param name="tokenToCharMultiple">When a tokenizer is not available, a simple way relate number of characters to number of tokens</param>
    [JsonConstructor]
    public ModelInfo(string name, int maxTokens = 4096, double tokenToCharMultiple = 2.5)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(name, nameof(name));

        _name = name;
        _maxTokens = maxTokens;
        _tokenToCharMultiple = tokenToCharMultiple;
        _maxCharCount = (int)((double)maxTokens * tokenToCharMultiple);
    }

    /// <summary>
    /// Modelname
    /// </summary>
    [JsonPropertyName("name")]
    public string Name => _name;

    /// <summary>
    /// Maximum tokens allowed by this model
    /// </summary>
    [JsonPropertyName("maxTokens")]
    public int MaxTokens => _maxTokens;

    /// <summary>
    /// Allows a simple way to estimate # of tokens from # of characters
    /// </summary>
    [JsonPropertyName("tokenMultiple")]
    public double TokenToCharMultiple => _tokenToCharMultiple;

    /// <summary>
    /// An estimate of the max # of characters - input + output - that the model will accept
    /// </summary>
    [JsonIgnore]
    public int MaxCharCount => _maxCharCount;

    public static implicit operator ModelInfo(string name)
    {
        return new ModelInfo(name);
    }
}
