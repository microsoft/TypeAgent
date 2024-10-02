// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TypeAgent.Core;

public static class StringEx
{
    public static StringBuilder AppendHeader(this StringBuilder sb, string name, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            sb.Append(name);
            sb.Append(": ");
            sb.AppendLine(value);
        }
        return sb;
    }
}
