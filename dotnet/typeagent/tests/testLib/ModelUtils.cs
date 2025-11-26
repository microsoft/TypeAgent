// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.AIClient;

namespace TypeAgent.TestLib;

public class ModelUtils
{
    public static IChatModel CreateTestChatModel(string modelName)
    {
        var model = new OpenAIChatModel();
        model.Settings.ModelName = modelName;

        return model;
    }
}
