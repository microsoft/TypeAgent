// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class CompileExtensions
{
    public static bool IsNullOrEmpty(this SearchTermGroup searchTermGroup)
    {
        return searchTermGroup is null || searchTermGroup.IsEmpty;
    }

    public static bool IsWildcard(this string value) => value == "*";

    public static bool IsSearchable(this string value)
        => !(string.IsNullOrEmpty(value) || IsWildcard(value));
}
