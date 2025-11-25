// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;

namespace TypeAgent.TestLib;

public static class TestHelpers
{
    public static void LoadDotEnvOrSkipTest()
    {
        if (Dotenv.LoadIfExists(Dotenv.DEFAULT_DOT_ENV_LOCATION) == 0)
        {
            throw SkipException.ForSkip("Missing .ENV configuration, can't run tests.");
        }
    }
}
