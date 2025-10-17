// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A text prompt Section
/// </summary>
public class PromptSection : IPromptSection
{
    /// <summary>
    /// Standard sources of prompt sections
    /// </summary>
    public static class Sources
    {
        /// <summary>
        /// This section contains text supplied by the system
        /// </summary>
        public const string System = "system";

        /// <summary>
        /// This section contains text supplied by the user
        /// </summary>
        public const string User = "user";

        /// <summary>
        /// This section contains text produced by an AI assistant or model
        /// </summary>
        public const string Assistant = "assistant";
    }

    public static readonly PromptSection Empty = FromUser(string.Empty);

    private readonly string _source;
    private string _text;

    /// <summary>
    /// Create an empty prompt section
    /// </summary>
    public PromptSection()
        : this(string.Empty)
    {
    }

    /// <summary>
    /// Create a prompt section with the given text
    /// Sets the Source to 'User'
    /// </summary>
    /// <param name="text"></param>
    public PromptSection(string text)
        : this(Sources.User, text)
    {
    }

    /// <summary>
    /// Creates a new prompt section
    /// </summary>
    /// <param name="source">source of the section</param>
    /// <param name="text">section text</param>
    /// <exception cref="ArgumentException"></exception>
    /// <exception cref="ArgumentNullException"></exception>
    public PromptSection(string source, string text)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(source, nameof(source));
        ArgumentVerify.ThrowIfNull(text, nameof(text));

        _source = source;
        SetText(text);
    }

    /// <summary>
    /// The Source of this section. 
    /// </summary>
    public string? Source => _source;

    /// <summary>
    /// Return the text for this section
    /// </summary>
    /// <returns>string</returns>
    public string GetText() => _text;

    /// <summary>
    /// Is the section empty?
    /// </summary>
    [JsonIgnore]
    public bool IsEmpty => string.IsNullOrEmpty(_text);

    /// <summary>
    /// Replace the section text
    /// </summary>
    /// <param name="text">text to set</param>
    /// <exception cref="ArgumentNullException"></exception>
    public void SetText(string text)
    {
        ArgumentVerify.ThrowIfNull(text, nameof(text));
        _text = text;
    }

    /// <summary>
    /// Append text to the section
    /// </summary>
    /// <param name="text">text to append</param>
    public void Append(string text)
    {
        if (IsEmpty)
        {
            _text = text;
        }
        else
        {
            _text += text;
        }
    }

    public override string ToString()
    {
        return $"{_source}: {_text}";
    }

    /// <summary>
    /// Construct a prompt section whose source is the user
    /// </summary>
    /// <param name="text"></param>
    public static implicit operator PromptSection(string text) => FromUser(text);

    /// <summary>
    /// New prompt section whose source is System
    /// </summary>
    /// <param name="text">section text</param>
    /// <returns>PromptSection</returns>
    public static PromptSection FromSystem(string text) => new PromptSection(Sources.System, text);

    /// <summary>
    /// New prompt section whose source is User
    /// </summary>
    /// <param name="text">section text</param>
    /// <returns>PromptSection</returns>
    public static PromptSection FromUser(string text) => new PromptSection(Sources.User, text);

    /// <summary>
    /// New prompt section whose source is Assistant
    /// </summary>
    /// <param name="text">section text</param>
    /// <returns>PromptSection</returns>
    public static PromptSection FromAssistant(string text) => new PromptSection(Sources.Assistant, text);

    /// <summary>
    /// Create a new Instruction
    /// </summary>
    /// <param name="text">section text</param>
    /// <returns>PromptSection</returns>
    public static PromptSection Instruction(string text) => FromSystem(text);

    /// <summary>
    /// Append text to the given section
    /// </summary>
    /// <param name="section">section to append to</param>
    /// <param name="text">text to append</param>
    /// <returns></returns>
    public static PromptSection operator +(PromptSection section, string text)
    {
        section.Append(text);
        return section;
    }
}
