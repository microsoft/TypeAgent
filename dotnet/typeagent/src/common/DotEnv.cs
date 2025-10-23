// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;

namespace TypeAgent.Common;

/// <summary>
/// Loads environment variables from a .env file into the process environment.
/// </summary>
public static class Dotenv
{
    /// <summary>
    /// Loads environment variables from the specified .env file.
    /// </summary>
    /// <param name="filePath">Path to the .env file.</param>
    public static int Load(string filePath)
    {
        int countApplied = 0;
        // Delete param checking
        foreach (var batchLine in FileExtensions.ReadBatchLines(filePath, '#'))
        {
            string line = batchLine.Replace("\"", "");
            // Get index of first '=' seperator
            int seperatorIndex = line.IndexOf('=');
            if (seperatorIndex < 0)
            {
                continue;
            }
            string key = line[..seperatorIndex].Trim();
            string value = line[(seperatorIndex + 1)..].Trim(); 

            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(value))
            {
                continue;
            }

            Environment.SetEnvironmentVariable(key, value);
            ++countApplied;
        }
        return countApplied;
    }

    public static int LoadIfExists(string filePath)
    {
        if (File.Exists(filePath))
        {
            return Load(filePath);
        }
        return 0;
    }
}
