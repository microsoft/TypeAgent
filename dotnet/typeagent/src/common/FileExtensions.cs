// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TypeAgent.Common;

public static class FileExtensions
{
    public static void RemoveFiles(params string[] filePaths)
    {
        foreach(string filePath in filePaths)
        {
            File.Delete(filePath);
        }
    }
}
