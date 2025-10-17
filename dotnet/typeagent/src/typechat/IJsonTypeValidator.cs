// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A JsonTypeValidator validates the given json string is according to the supplied schema
/// If valid, returns the json transformed into a value of type T
/// </summary>
/// <typeparam name="T">Type T</typeparam>
public interface IJsonTypeValidator<T>
{
    /// <summary>
    /// Validation Schema
    /// </summary>
    TypeSchema Schema { get; }

    /// <summary>
    /// Parses and validates the given JSON string according to the associated schema. Returns a
    /// Result containing the JSON object if validation was successful.Otherwise, returns
    /// an Result with a message property that contains validation diagnostics.
    /// </summary>
    /// <param name="json"></param>
    /// <returns></returns>
    Result<T> Validate(string json);
}
