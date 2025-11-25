// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.TestLib;

public static class QueryUtils
{

    public static string GetAbsolutePath(string relativePath)
    {
        return Path.Combine(Environment.CurrentDirectory, relativePath);
    }

    public static string GetRootDataPath()
    {
        return Path.Combine(Path.GetTempPath(), "/data/tests");
    }

    public static string GetOutputDirPath(string relativePath)
    {
        return Path.Combine(GetRootDataPath(), relativePath);
    }

    private static List<string> ReadTestFile(string path, int? maxQueries = null)
    {
        string absolutePath = Path.IsPathRooted(path)
            ? path
            : GetAbsolutePath(path);

        List<string> lines = [];
        using StreamReader sr = new StreamReader(absolutePath);
        while(sr.Peek() > -1 && (maxQueries is null || lines.Count < maxQueries))
        {
            string? line = sr.ReadLine();

            if (!string.IsNullOrEmpty(line) && !line.StartsWith('#'))
            {
                lines.Add(line);
            }
        }

        return [.. lines];
    }

    public static List<string> LoadTestQueries(string path, int? maxQueries = null)
    {
        return ReadTestFile(path, maxQueries);
    }
}
