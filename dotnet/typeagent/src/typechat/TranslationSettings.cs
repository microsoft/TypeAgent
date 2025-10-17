// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Settings used by the language model during translation
/// </summary>
public class TranslationSettings
{
    /// <summary>
    /// Temperature to use. We recommend using 0
    /// </summary>
    public double Temperature { get; set; } = 0;

    /// <summary>
    /// Maximum number of tokens to emit. 
    /// </summary>
    public int MaxTokens { get; set; } = -1;
}
