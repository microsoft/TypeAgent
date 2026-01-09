// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// The standard prompts used by JsonTranslator
/// You can customize prompts you give to the translator as per your scenario
/// To do so, you can implement IJsonTranslatorPrompts OR just inherit from this class and override
/// </summary>
public class JsonTranslatorPrompts : IJsonTranslatorPrompts
{
    internal static readonly JsonTranslatorPrompts Default = new JsonTranslatorPrompts();
    public static readonly JsonTranslatorSystemPrompts System = new JsonTranslatorSystemPrompts();

    public virtual Prompt CreateRequestPrompt(TypeSchema typeSchema, Prompt request, IList<IPromptSection> context = null)
    {
        ArgumentVerify.ThrowIfNull(request, nameof(request));
        Prompt prompt = new Prompt();

        prompt += IntroSection(typeSchema.TypeName, typeSchema.Schema);
        AddContextAndRequest(prompt, request, context);

        return prompt;
    }

    public virtual string CreateRepairPrompt(TypeSchema schema, string json, string validationError)
    {
        return RepairPrompt(validationError);
    }

    /// <summary>
    /// Add the given user request and any context to the prompt we are sending to the model
    /// </summary>
    /// <param name="prompt">prompt being constructed</param>
    /// <param name="request">user request</param>
    /// <param name="context">any RAG context</param>
    /// <returns>prompt to send to the model</returns>
    public static Prompt AddContextAndRequest(Prompt prompt, Prompt request, IList<IPromptSection> context)
    {
        if (!context.IsNullOrEmpty())
        {
            prompt.Append(context);
        }

        if (request.Count >= 1)
        {
            prompt += RequestSection(request[0].GetText());
            return prompt;
        }

        prompt.AppendInstruction("USER REQUEST:");
        prompt.Append(request);
        prompt += "The following is USER REQUEST translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n";
        return prompt;
    }

    /// <summary>
    /// Adds a section that tells the model that its task to is translate requests into JSON matching the
    /// given schema
    /// </summary>
    /// <param name="typeName">The response type name.</param>
    /// <param name="schema">The schema to generate reponses in.</param>
    /// <returns>The prompt string for this instruction.</returns>
    public static PromptSection IntroSection(string typeName, string schema)
    {
        PromptSection introSection = new PromptSection();
        introSection += $"You are a service that translates user requests into JSON objects of type \"{typeName}\" according to the following TypeScript definitions:\n";
        introSection += $"```\n{schema}```\n";
        return introSection;
    }

    public static PromptSection RequestSection(string request)
    {
        PromptSection requestSection = new PromptSection();
        requestSection += "The following is a user request:\n";
        requestSection += $"\"\"\"\n{request}\n\"\"\"\n";
        requestSection += "The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n";
        return requestSection;
    }

    public static string RepairPrompt(string validationError)
    {
        validationError ??= string.Empty;
        return "The JSON object is invalid for the following reason:\n" +
               $"{validationError}\n" +
               "The following is a revised JSON object. Do not include explanations.\n";
    }
}

/// <summary>
/// In this prompting translation system the system prompt is used to instruct the model
/// including the response type, schema, and purpose of the translation. This allows the request
/// to just contain user messages.
/// </summary>
public class JsonTranslatorSystemPrompts : IJsonTranslatorPrompts
{
    public Prompt CreateRequestPrompt(TypeSchema typeSchema, Prompt request, IList<IPromptSection> preamble)
    {
        Prompt prompt = [];

        // make sure the preamble has some system instructions
        bool hasSystemPromptSection = false;
        foreach (var promptSection in preamble)
        {
            if (promptSection.Source == PromptSection.Sources.System)
            {
                hasSystemPromptSection = true;
                break;
            }
        }

        if (preamble.Count == 0 || !hasSystemPromptSection)
        {
            throw new InvalidOperationException("No system prompt section found in preamble. Please provide one.");
        }

        foreach(var promptSection in request)
        {
            if (promptSection.Source == PromptSection.Sources.System)
            {
                throw new InvalidOperationException("System prompt sections are not allowed in the request when using JsonTranslatorSystemPrompts. Please move them to the preamble.");
            }
        }


        prompt.AddRange(preamble);
        prompt.Add(SystemSectionReturnType(typeSchema.TypeName, typeSchema.Schema));
        prompt.AddRange(request);

        return prompt;
    }
    public string CreateRepairPrompt(TypeSchema schema, string json, string validationError)
    {
        return JsonTranslatorPrompts.Default.CreateRepairPrompt(schema, json, validationError);
    }

    /// <summary>
    /// Adds a section that tells the model that its task to is translate requests into JSON matching the
    /// given schema
    /// </summary>
    /// <param name="typeName">The response type name.</param>
    /// <param name="schema">The schema to generate reponses in.</param>
    /// <returns>The prompt string for this instruction.</returns>
    public static PromptSection SystemSectionReturnType(string typeName, string schema)
    {
        PromptSection introSection = new PromptSection(PromptSection.Sources.System, string.Empty);
        introSection += $"Respond only in valid JSON objects of type \"{typeName}\" according to the following TypeScript definitions:\n";
        introSection += $"```typescript\n{schema}```\n";
        return introSection;
    }

}
