// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Json Translators use a request Prompt and a repair Prompt. This interface lets you customize both.
/// A repair prompt 
/// </summary>
public interface IJsonTranslatorPrompts
{
    /// <summary>
    /// Creates a prompt from the given request, instructing the AI language mode to
    /// translate the request into JSON using the supplied schema
    /// </summary>
    /// <param name="schema">Schema for the JSON the model should return</param>
    /// <param name="request">request</param>
    /// <param name="preamble">Preamble/additional instructions to send to the model</param>
    /// <returns></returns>
    Prompt CreateRequestPrompt(TypeSchema schema, Prompt request, IList<IPromptSection> preamble);

    /// <summary>
    /// Creates a repair prompt to append to an original prompt/response in order to repair a JSON object that
    /// failed to validate.
    /// </summary>
    /// <param name="schema">Schema for the JSON the model should return</param>
    /// <param name="json">The json returned by the model</param>
    /// <param name="validationError"></param>
    /// <returns></returns>
    string CreateRepairPrompt(TypeSchema schema, string json, string validationError);
}
