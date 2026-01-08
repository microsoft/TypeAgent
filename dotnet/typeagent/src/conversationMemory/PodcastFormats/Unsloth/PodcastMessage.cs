// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TypeAgent.ConversationMemory.PodcastFormats.Unsloth;

public class PodcastMessage
{
    [JsonPropertyName("speaker")]
    public string? Speaker { get; set; } = null;

    [JsonPropertyName("content")]
    public string? Content { get; set; } = null;

    [JsonPropertyName("section_title")]
    public string? SectionTitle { get; set; } = null;

    /// <summary>
    /// Explicit Cast from Unsloth.PodcastMessage to ConversationMemory.PodcastMessage
    /// </summary>
    /// <param name="unslothMessage">The unsloth message to convert</param>
    public static explicit operator ConversationMemory.PodcastMessage(PodcastMessage unslothMessage)
    {
        ArgumentVerify.ThrowIfNull(unslothMessage, nameof(unslothMessage));

        return new ConversationMemory.PodcastMessage(
            unslothMessage.Content ?? string.Empty,
            unslothMessage.Speaker ?? string.Empty,
            string.IsNullOrEmpty(unslothMessage.SectionTitle) ? [] : [unslothMessage.SectionTitle]
        );
    }
}
