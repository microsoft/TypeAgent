// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;
using Xunit.Sdk;

namespace TypeAgent.TestLib;

public class TestWithTemporaryFiles
{
    protected DirectoryInfo _tempDir { get; set; }

    /// <summary>
    /// Test setup including loading .ENV settings and creating temporary folder for sqlite DB
    /// </summary>
    public TestWithTemporaryFiles()
    {
        _tempDir = Directory.CreateTempSubdirectory($"TypeAgent_{this.GetType().Name}");

        if (Dotenv.LoadIfExists(Dotenv.DEFAULT_DOT_ENV_LOCATION) == 0)
        {
            throw SkipException.ForSkip("Missing .ENV configuration, can't run tests.");
        }
    }

    /// <summary>
    /// Cleans up test data
    /// </summary>
    ~TestWithTemporaryFiles()
    {
        Directory.Delete(_tempDir.FullName, true);
    }
}
