// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// JsonTranslator uses this interface to communicates with AI models that can translate natural language requests to JSON
/// instances according to a provided schema.
/// </summary>
public interface ILanguageModel
{
    /// <summary>
    /// Get a completion for the given prompt
    /// </summary>
    /// <param name="prompt">prompt</param>
    /// <param name="settings">translation settings such as temperature</param>
    /// <param name="cancelToken">cancellation token</param>
    /// <returns></returns>
    Task<string> CompleteAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken);
}
