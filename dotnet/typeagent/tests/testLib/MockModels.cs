// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.TypeChat;
using TypeAgent.AIClient;

namespace TypeAgent.TestLib;

public class MockModel_No_JSON_Response : IChatModel
{
    public Task<string> CompleteAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken)
    {

        return Task.Run(() => "Mock response", cancelToken);
    }

    public Task<string> CompleteTextAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken)
    {
        return Task.Run(() => "Mock response", cancelToken);
    }

    public TokenCounter TokenCounter => new TokenCounter();
}

public class MockModel_Partial_JSON_Response : IChatModel
{
    public Task<string> CompleteAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken)
    {

        return Task.Run(() => "{ \"text\": \"partial json\"", cancelToken);
    }

    public Task<string> CompleteTextAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancelToken)
    {
        return Task.Run(() => "{ \"text\": \"partial json\"", cancelToken);
    }

    public TokenCounter TokenCounter => new TokenCounter();
}
