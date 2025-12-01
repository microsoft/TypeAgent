// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;

namespace TypeAgent.TestLib;

public class TestWithTemporaryFiles
{
    protected DirectoryInfo _tempDir { get; set; }

    /// <summary>
    /// Test setup including loading .ENV settings and creating temporary folder for sqlite DB
    /// </summary>
    public TestWithTemporaryFiles(bool loadDotEnv)
    {
        _tempDir = Directory.CreateTempSubdirectory($"TypeAgent_{this.GetType().Name}");

        TestHelpers.LoadDotEnvOrSkipTest();
    }

    /// <summary>
    /// Cleans up test data
    /// </summary>
    ~TestWithTemporaryFiles()
    {
        Directory.Delete(_tempDir.FullName, true);
    }
}
