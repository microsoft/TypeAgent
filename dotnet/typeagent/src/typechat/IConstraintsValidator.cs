// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Once Json Translator has a valid value of type T, applies additional
/// constraints validation and business rules
/// </summary>
public interface IConstraintsValidator<T>
{
    /// <summary>
    /// Validate the value T
    /// </summary>
    /// <param name="value">check constraints for this value</param>
    /// <returns>result of the validation</returns>
    Result<T> Validate(T value);
}
