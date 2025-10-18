// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class CompileExtensions
{
    public static bool IsNullOrEmpty(this SearchTermGroup searchTermGroup)
    {
        return searchTermGroup is null || searchTermGroup.IsEmpty;
    }
}
