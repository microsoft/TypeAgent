// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.AIClient;

namespace TypeAgent.TestLib;
internal class EnvHelper
{
    public static bool HasTestKeys()
    {
        return EnvVars.HasKey(EnvVars.AZURE_OPENAI_API_KEY) && EnvVars.HasKey(EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING);
    }
}
