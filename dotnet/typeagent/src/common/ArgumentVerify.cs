// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.CompilerServices;

namespace TypeAgent.Common;

/// <summary>
/// Reserved for Typechat infrastructure
/// Used by Typechat libraries to do argument validation in a .NET framework agnostic way
/// </summary>
public static class ArgumentVerify
{
    public static void Throw(string message)
    {
        throw new ArgumentException(message);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfNull(object? argument, string paramName)
    {
        if (argument is null)
        {
            throw new ArgumentNullException(paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfNullOrEmpty(string? argument, string paramName)
    {
        ThrowIfNull(argument, paramName);
        if (string.IsNullOrEmpty(argument))
        {
            throw new ArgumentException("The value cannot be an empty string.", paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfNullOrEmpty<T>(IList<T> array, string paramName)
    {
        ThrowIfNull(array, paramName);
        if (array.Count == 0)
        {
            throw new ArgumentException("The list cannot be empty.", paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfGreaterThanEqual(int value, int max, string paramName)
    {
        if (value >= max)
        {
            throw new ArgumentOutOfRangeException($"The value must be < {max}", paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfGreaterThan(int value, int max, string paramName)
    {
        if (value > max)
        {
            throw new ArgumentOutOfRangeException($"The value must be <= {max}", paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfLessThanEqual(int value, int max, string paramName)
    {
        if (value <= max)
        {
            throw new ArgumentOutOfRangeException($"The value must be > {max}", paramName);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ThrowIfLessThanEqualZero(int value, string paramName) => ThrowIfLessThanEqual(value, 0, paramName);
}
