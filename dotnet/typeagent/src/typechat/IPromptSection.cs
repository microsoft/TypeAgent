// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A prompt is a list of multiple prompt sections
/// Each section provides text that can originate from sources like users and AI assistants
/// </summary>
public interface IPromptSection
{
    /// <summary>
    /// The source of this prompt section
    /// Typical sources - user, system and assistant - are defined in PromptSection.Sources
    /// </summary>
    public string? Source { get; }

    /// <summary>
    /// Get the text for this section
    /// </summary>
    /// <returns>string</returns>
    string GetText();
}
