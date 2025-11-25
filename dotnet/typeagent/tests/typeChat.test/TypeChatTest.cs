// Copyright (c) Microsoft. All rights reserved.

using System.Diagnostics;
using System.Reflection;
using Microsoft.TypeChat.Schema;
using Xunit.Abstractions;

namespace Microsoft.TypeChat.Tests;

public class TypeChatTest
{
    private readonly ITestOutputHelper? _output;

    public TypeChatTest(ITestOutputHelper? output = null)
    {
        _output = output;
    }

    public ITestOutputHelper? Output => _output;

    public void WriteLine(string message)
    {
        if (_output is not null)
        {
            _output.WriteLine(message);
        }
        else
        {
            Trace.WriteLine(message);
        }
    }

    public void WriteSkipped(string testName, string reason)
    {
        WriteLine($"SKIPPED: {testName}. {reason}");
    }

    public string? GetEnv(string name)
    {
        return Environment.GetEnvironmentVariable(name);
    }

    public string? SetEnv(string name, string value)
    {
        string? prev = GetEnv(name);
        Environment.SetEnvironmentVariable(name, value, EnvironmentVariableTarget.Process);
        return prev;
    }

    public void ClearEnv(string name)
    {
        Environment.SetEnvironmentVariable(name, null, EnvironmentVariableTarget.Process);
    }

    // *Very* basic checks.
    // Need actual robust validation, e.g. by loading in Typescript
    //   
    public void ValidateBasic(Type type, TypeSchema schema)
    {
        Assert.NotNull(schema);
        Assert.Equal(type, schema.Type);
        Assert.False(string.IsNullOrEmpty(schema.Schema));
    }

    public static void ValidateContains(string text, params string[] values)
    {
        // Kludgy for now
        foreach (var entry in values)
        {
            Assert.Contains(entry, text);
        }
    }

    //public bool CanRunEndToEndTest(OpenAIConfig config)
    //{
    //    return !string.IsNullOrEmpty(config.ApiKey) && config.ApiKey != "?";

    //    //return (config.HasOpenAI &&
    //    //        !string.IsNullOrEmpty(config.OpenAI.ApiKey) &&
    //    //        config.OpenAI.ApiKey != "?");
    //}

    //public bool CanRunEndToEndTest(OpenAIConfig config, string testName)
    //{
    //    if (CanRunEndToEndTest(config))
    //    {
    //        return true;
    //    }
    //    WriteSkipped(testName, "NO OpenAI Configured");
    //    return false;
    //}

    //public bool CanRunEndToEndTest_Embeddings(OpenAIConfig config)
    //{
    //    return (config. &&
    //            !string.IsNullOrEmpty(config.OpenAIEmbeddings.ApiKey) &&
    //            config.OpenAIEmbeddings.ApiKey != "?");
    //}

    //public bool CanRunEndToEndTest_Embeddings(OpenAIConfig config, string testName)
    //{
    //    if (CanRunEndToEndTest_Embeddings(config))
    //    {
    //        return true;
    //    }
    //    WriteSkipped(testName, "NO OpenAI Embeddings Configured");
    //    return false;
    //}

    public MethodInfo? GetMethod(Type type, string name)
    {
        MethodInfo[] methods = type.GetMethods();
        foreach (var method in methods)
        {
            if (method.Name == name)
            {
                return method;
            }
        }
        return null;
    }

    public OpenAIConfig MockOpenAIConfig(bool azure = true)
    {
        OpenAIConfig config = new OpenAIConfig
        {
            Azure = azure,
            ApiKey = "NOT_A_KEY",
            Model = "gpt-35-turbo"
        };
        if (azure)
        {
            config.Endpoint = "https://YOUR_RESOURCE_NAME.openai.azure.com";
        }
        else
        {
            config.Endpoint = "https://api.openai.com/v1/chat/completions";
            config.Organization = "NOT_AN_ORG";
        }
        return config;
    }
}

