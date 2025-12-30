// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Microsoft.TypeChat.Tests;

public class JsonTests
{
    private class TestClass
    {
        public int Id { get; set; }
        public string? Name { get; set; }
    }

    [Fact]
    public void Stringify_Object_Indented_True()
    {
        var obj = new TestClass { Id = 1, Name = "Test" };
        string json = Microsoft.TypeChat.Json.Stringify(obj, true);
        Assert.Contains(Environment.NewLine, json);
        Assert.Contains("\"Id\"", json);
        Assert.Contains("\"Name\"", json);
    }

    [Fact]
    public void Stringify_Object_Indented_False()
    {
        var obj = new TestClass { Id = 2, Name = "NoIndent" };
        string json = Microsoft.TypeChat.Json.Stringify(obj, false);
        Assert.DoesNotContain(Environment.NewLine, json);
        Assert.Contains("\"Id\"", json);
        Assert.Contains("\"Name\"", json);
    }

    [Fact]
    public void Stringify_Generic_Indented_True()
    {
        var obj = new TestClass { Id = 3, Name = "Generic" };
        string json = Microsoft.TypeChat.Json.Stringify<TestClass>(obj, true);
        Assert.Contains(Environment.NewLine, json);
        Assert.Contains("\"Id\"", json);
        Assert.Contains("\"Name\"", json);
    }

    [Fact]
    public void Parse_Object_From_Json_String()
    {
        string json = "{\"Id\":4,\"Name\":\"ParseTest\"}";
        var result = (TestClass?)Microsoft.TypeChat.Json.Parse(json, typeof(TestClass));
        Assert.NotNull(result);
        Assert.Equal(4, result.Id);
        Assert.Equal("ParseTest", result.Name);
    }

    [Fact]
    public void Parse_Generic_From_Json_String()
    {
        string json = "{\"Id\":5,\"Name\":\"GenericParse\"}";
        var result = Microsoft.TypeChat.Json.Parse<TestClass>(json);
        Assert.NotNull(result);
        Assert.Equal(5, result.Id);
        Assert.Equal("GenericParse", result.Name);
    }

    [Fact]
    public void Parse_Generic_From_Stream()
    {
        var obj = new TestClass { Id = 6, Name = "StreamParse" };
        string json = Microsoft.TypeChat.Json.Stringify(obj, false);
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        var result = Microsoft.TypeChat.Json.Parse<TestClass>(stream);
        Assert.NotNull(result);
        Assert.Equal(6, result.Id);
        Assert.Equal("StreamParse", result.Name);
    }

    [Fact]
    public void DefaultOptions_Returns_Options()
    {
        var options = Microsoft.TypeChat.Json.DefaultOptions();
        Assert.NotNull(options);
        Assert.True(options.WriteIndented == false || options.WriteIndented == true);
    }
}
