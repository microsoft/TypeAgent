// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;

namespace Microsoft.TypeChat.Tests;

public class TestConfig : TypeChatTest
{
    [Fact]
    public void TestEnvOpenAI()
    {
        string? prevAzureKey = null;
        string? prevAzureEndpoint = null;
        string? prevEndpoint = null;
        string? prevKey = null;
        string? prevOrg = null;
        string? prevModel = null;
        try
        {
            prevAzureKey = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, string.Empty);
            prevAzureEndpoint = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, string.Empty);
            prevEndpoint = SetEnv(OpenAIConfig.VariableNames.OPENAI_ENDPOINT, "O_ENDPOINT");
            prevKey = SetEnv(OpenAIConfig.VariableNames.OPENAI_API_KEY, "O_API");
            prevOrg = SetEnv(OpenAIConfig.VariableNames.OPENAI_ORGANIZATION, "O_ORG");
            prevModel = SetEnv(OpenAIConfig.VariableNames.OPENAI_MODEL, "O_MODEL");

            var config = OpenAIConfig.FromEnvironment();
            Assert.False(config.Azure);
            Assert.Equal("O_ENDPOINT", config.Endpoint);
            Assert.Equal("O_API", config.ApiKey);
            Assert.Equal("O_ORG", config.Organization);
            Assert.Equal("O_MODEL", config.Model);
        }
        finally
        {
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, prevAzureKey);
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, prevAzureEndpoint);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_ENDPOINT, prevEndpoint);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_API_KEY, prevKey);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_ORGANIZATION, prevOrg);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_MODEL, prevModel);
        }
    }

    [Fact]
    public void TestEnvOpenAIEmbedding()
    {
        string? prevAzureKey = null;
        string? prevAzureEndpoint = null;
        string? prevEndpoint = null;
        string? prevKey = null;
        string? prevOrg = null;
        string? prevModel = null;
        try
        {
            prevAzureKey = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, string.Empty);
            prevAzureEndpoint = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, string.Empty);
            prevEndpoint = SetEnv(OpenAIConfig.VariableNames.OPENAI_ENDPOINT, "O_ENDPOINT");
            prevKey = SetEnv(OpenAIConfig.VariableNames.OPENAI_API_KEY, "O_API");
            prevOrg = SetEnv(OpenAIConfig.VariableNames.OPENAI_ORGANIZATION, "O_ORG");
            prevModel = SetEnv(OpenAIConfig.VariableNames.OPENAI_EMBEDDINGMODEL, "O_EMBEDDING");

            var config = OpenAIConfig.FromEnvironment(true);
            Assert.False(config.Azure);
            Assert.Equal("O_ENDPOINT", config.Endpoint);
            Assert.Equal("O_API", config.ApiKey);
            Assert.Equal("O_ORG", config.Organization);
            Assert.Equal("O_EMBEDDING", config.Model);
        }
        finally
        {
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, prevAzureKey);
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, prevAzureEndpoint);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_ENDPOINT, prevEndpoint);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_API_KEY, prevKey);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_ORGANIZATION, prevOrg);
            SetEnv(OpenAIConfig.VariableNames.OPENAI_EMBEDDINGMODEL, prevModel);
        }
    }

    [Fact]
    public void TestEnvAzure()
    {
        string? prevEndpoint = null;
        string? prevKey = null;
        try
        {
            prevEndpoint = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, "A_ENDPOINT");
            prevKey = SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, "A_API");

            var config = OpenAIConfig.FromEnvironment();
            Assert.True(config.Azure);
            Assert.Equal("A_ENDPOINT", config.Endpoint);
            Assert.Equal("A_API", config.ApiKey);
        }
        finally
        {
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_ENDPOINT, prevEndpoint);
            SetEnv(OpenAIConfig.VariableNames.AZURE_OPENAI_API_KEY, prevKey);
        }
    }

    [Fact]
    public void TestConfigFromFile()
    {
        // create a temp config file
        string file = Path.GetTempFileName();
        var config = OpenAIConfig.FromEnvironment();
        var sconfig = JsonSerializer.Serialize(config);
        File.WriteAllText(file, sconfig);
        var fileCfg = OpenAIConfig.LoadFromJsonFile(file);

        Assert.Equal(sconfig, JsonSerializer.Serialize(fileCfg));
    }

    [Fact]
    public void TestInvalidConfigFile()
    {
        string file = Path.GetTempFileName();
        File.AppendAllText(file, "");

        Assert.Throws<ArgumentException>(() =>
        {
            var config = OpenAIConfig.LoadFromJsonFile(file);
            config.Validate(file);
        });

        File.Delete(file);
    }
}
