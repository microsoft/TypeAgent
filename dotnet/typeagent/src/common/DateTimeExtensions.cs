// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class DateTimeExtensions
{
    public static string ToISOString(this DateTimeOffset dt)
    {
        return dt.ToString("o");
    }
}
