// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A prompt is a list of one or more prompt sections
/// </summary>
public class Prompt : List<IPromptSection>
{
    /// <summary>
    /// Create an empty prompt
    /// </summary>
    public Prompt()
        : base()
    {
    }

    /// <summary>
    /// Create a Prompt using the given prompt section
    /// </summary>
    /// <param name="text">section</param>
    public Prompt(PromptSection? text = null)
        : this(null, text, null)
    {
    }

    /// <summary>
    /// Create a prompt that concatenates a preamble, prompt text and a postamble
    /// Preambles are typically used to supply instructions or context to the model
    /// The prompt text is the user request
    /// The postamble may contain additional instructions
    /// </summary>
    /// <param name="preamble">prompt preamble</param>
    /// <param name="text">prompt text</param>
    /// <param name="postamble"></param>
    public Prompt(IEnumerable<IPromptSection>? preamble, PromptSection? text = null, IEnumerable<IPromptSection>? postamble = null)
    {
        if (preamble is not null)
        {
            AddRange(preamble);
        }
        if (text is not null)
        {
            Add(text);
        }
        if (postamble is not null)
        {
            AddRange(postamble);
        }
    }

    /// <summary>
    /// Add a new section to the prompt
    /// </summary>
    /// <param name="section"></param>
    /// <exception cref="ArgumentNullException"></exception>
    public new void Add(IPromptSection section)
    {
        ArgumentVerify.ThrowIfNull(section, nameof(section));
        base.Add(section);
    }

    /// <summary>
    /// Append a section from the given source
    /// </summary>
    /// <param name="source">The source of the section</param>
    /// <param name="section">section to append</param>
    public void Append(string source, string section)
    {
        Add(new PromptSection(source, section));
    }

    /// <summary>
    /// Append the given text whose source is the user
    /// </summary>
    /// <param name="section"></param>
    public void Append(string section) => Append(PromptSection.Sources.User, section);

    /// <summary>
    /// Append an instruction. The source of instructions is System 
    /// </summary>
    /// <param name="section"></param>
    public void AppendInstruction(string section) => Append(PromptSection.Sources.System, section);

    /// <summary>
    /// Append a response the prompt. The source of responses is Assistant
    /// </summary>
    /// <param name="section"></param>
    public void AppendResponse(string section) => Append(PromptSection.Sources.Assistant, section);

    /// <summary>
    /// Append the given prompt section to this prompt
    /// </summary>
    /// <param name="section"></param>
    public void Append(IPromptSection section) => Add(section);

    /// <summary>
    /// Append the given prompt sections to this prompt
    /// </summary>
    /// <param name="prompts">enumerable of sections to append</param>
    public void Append(IEnumerable<IPromptSection> prompts) => base.AddRange(prompts);

    /// <summary>
    /// Append the given prompt to this one
    /// </summary>
    /// <param name="prompt"></param>
    public void Append(Prompt prompt) => base.AddRange(prompt);

    /// <summary>
    /// Return the most recently appended section
    /// </summary>
    /// <returns></returns>
    public IPromptSection? Last()
    {
        int position = IndexOfLast();
        if (position >= 0)
        {
            return this[position];
        }

        return null;
    }

    /// <summary>
    /// Combine all the sections of the prompt into the given string builder
    /// </summary>
    /// <param name="sectionSep">separator</param>
    /// <param name="includeSource">add the source of the section to the builder</param>
    /// <param name="sb">the string builder to append to</param>
    /// <returns>StringBuilder</returns>
    public StringBuilder JoinSections(string sectionSep, bool includeSource, StringBuilder sb = null)
    {
        sb ??= new StringBuilder();
        foreach (var section in this)
        {
            if (includeSource)
            {
                sb.Append(section.Source).Append(":\n");
            }
            sb.Append(section.GetText()).Append(sectionSep);
        }
        return sb;
    }

    public override string ToString() => ToString(false);

    /// <summary>
    /// Convert the Prompt into a single string by concatenating all sections
    /// </summary>
    /// <param name="includeSource">Include the source of each section in the string</param>
    /// <returns></returns>
    public string ToString(bool includeSource)
    {
        StringBuilder sb = JoinSections("\n", includeSource);
        return sb.ToString();
    }

    /// <summary>
    /// Iterates over all prompt sections in this prompt and adds up the lengths of each section
    /// </summary>
    /// <returns>total length of this prompt</returns>
    public int GetLength()
    {
        int total = 0;
        foreach (var section in this)
        {
            total += section.GetText().Length;
        }
        return total;
    }

    private int IndexOfLast()
    {
        return Count > 0 ? Count - 1 : -1;
    }

    public static implicit operator Prompt(string text) => new Prompt(text);

    public static implicit operator string(Prompt prompt) => prompt.ToString();

    /// <summary>
    /// Append the supplied section to this prompt
    /// </summary>
    /// <param name="prompt">prompt to append to</param>
    /// <param name="section">section to append to</param>
    /// <returns></returns>
    public static Prompt operator +(Prompt prompt, PromptSection section)
    {
        prompt.Append(section);
        return prompt;
    }
}
