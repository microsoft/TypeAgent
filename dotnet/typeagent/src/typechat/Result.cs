// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Result of an operation
/// If result is Failure, includes an optional diagnostic message
/// </summary>
/// <typeparam name="T">Returned type</typeparam>
public class Result
{
    /// <summary>
    /// Create a new result with the given diagnostic message
    /// </summary>
    /// <param name="success">success</param>
    /// <param name="message">diagnostic message</param>
    internal Result(bool success, string? message = null)
    {
        Success = success;
        Message = message;
    }

    /// <summary>
    /// Success or failure
    /// </summary>
    public bool Success { get; }

    /// <summary>
    /// Diagnostic message in case of failure
    /// </summary>
    public string? Message { get; }

    /// <summary>
    /// Create an error result
    /// </summary>
    /// <param name="message">diagnostic message</param>
    /// <returns>Result</returns>
    public static Result<T> Error<T>(string message)
    {
        return new Result<T>(false, message);
    }

    /// <summary>
    /// Create an Error result
    /// </summary>
    /// <param name="value">a value, if available</param>
    /// <param name="message"></param>
    /// <returns></returns>
    public static Result<T> Error<T>(T value, string message)
    {
        return new Result<T>(false, value, message);
    }
}

/// <summary>
/// Result of an operation that returns T.
/// If result is Success, then includes a Value of type T
/// If result is Failure, includes an optional diagnostic message
/// </summary>
/// <typeparam name="T">Returned type</typeparam>
public class Result<T> : Result
{
    /// <summary>
    /// Create a new result with the given value and diagnostic message
    /// </summary>
    /// <param name="value">result value</param>
    /// <param name="message">diagnostic message</param>
    internal Result(T value)
        : base(true)
    {
        Value = value;
    }

    /// <summary>
    /// Clones the given result
    /// </summary>
    /// <param name="value">result</param>
    public Result(Result<object?> result)
        : base(result.Success, result.Message)
    {
        Value = (T)result.Value;
    }

    internal Result(bool success, string? message)
        : this(success, default, message)
    {
    }

    internal Result(bool success, T value, string? message)
    : base(success, message)
    {
        Value = default;
    }

    /// <summary>
    /// Result value.
    /// </summary>
    public T Value { get; }

    public static implicit operator Result<T>(T value)
    {
        return new Result<T>(value);
    }
    public static implicit operator T(Result<T> result)
    {
        return result.Value;
    }
}
