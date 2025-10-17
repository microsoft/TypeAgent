// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A Json Translator translates a natural language request into an object
/// It does so by first having the language model translate the request into JSON.
/// The translator sends a schema describing the JSON it expects back to the model
/// Then it ensures that the returned model matches that schema, validates and deserializes it into an object
/// </summary>
public interface IJsonTranslator
{
    /// <summary>
    /// Translate the request into an object
    /// </summary>
    /// <param name="request">natural language request</param>
    /// <param name="cancelToken">cancelToken</param>
    /// <returns></returns>
    Task<object> TranslateToObjectAsync(string request, CancellationToken cancelToken);
}
