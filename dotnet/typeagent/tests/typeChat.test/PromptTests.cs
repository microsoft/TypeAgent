// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text;
using Microsoft.TypeChat;
using Xunit;

namespace Microsoft.TypeChat.Tests;

public class PromptTests
{
    [Fact]
    public void Constructor_EmptyPrompt_CreatesEmptyList()
    {
        var prompt = new Prompt();
        Assert.Empty(prompt);
    }

    [Fact]
    public void Constructor_PromptSection_AddsSection()
    {
        var section = new PromptSection("user", "Hello");
        var prompt = new Prompt(section);
        Assert.Single(prompt);
        Assert.Equal(section, prompt[0]);
    }

    [Fact]
    public void Constructor_PreambleTextPostamble_AddsAllSections()
    {
        var preamble = new[] { new PromptSection("system", "Pre") };
        var text = new PromptSection("user", "Main");
        var postamble = new[] { new PromptSection("assistant", "Post") };

        var prompt = new Prompt(preamble, text, postamble);

        Assert.Equal(3, prompt.Count);
        Assert.Equal("Pre", prompt[0].GetText());
        Assert.Equal("Main", prompt[1].GetText());
        Assert.Equal("Post", prompt[2].GetText());
    }

    [Fact]
    public void Add_NullSection_ThrowsArgumentNullException()
    {
        var prompt = new Prompt();
        Assert.Throws<ArgumentNullException>(() => prompt.Add(null));
    }

    [Fact]
    public void Append_StringSourceSection_AddsSection()
    {
        var prompt = new Prompt();
        prompt.Append("user", "Hello");
        Assert.Single(prompt);
        Assert.Equal("Hello", prompt[0].GetText());
        Assert.Equal("user", prompt[0].Source);
    }

    [Fact]
    public void Append_StringSection_AddsUserSection()
    {
        var prompt = new Prompt();
        prompt.Append("Hello");
        Assert.Single(prompt);
        Assert.Equal("Hello", prompt[0].GetText());
        Assert.Equal(PromptSection.Sources.User, prompt[0].Source);
    }

    [Fact]
    public void AppendInstruction_AddsSystemSection()
    {
        var prompt = new Prompt();
        prompt.AppendInstruction("Do this");
        Assert.Single(prompt);
        Assert.Equal("Do this", prompt[0].GetText());
        Assert.Equal(PromptSection.Sources.System, prompt[0].Source);
    }

    [Fact]
    public void AppendResponse_AddsAssistantSection()
    {
        var prompt = new Prompt();
        prompt.AppendResponse("Response");
        Assert.Single(prompt);
        Assert.Equal("Response", prompt[0].GetText());
        Assert.Equal(PromptSection.Sources.Assistant, prompt[0].Source);
    }

    [Fact]
    public void Append_PromptSection_AddsSection()
    {
        var prompt = new Prompt();
        var section = new PromptSection("user", "Hello");
        prompt.Append(section);
        Assert.Single(prompt);
        Assert.Equal(section, prompt[0]);
    }

    [Fact]
    public void Append_EnumerableSections_AddsAll()
    {
        var prompt = new Prompt();
        var sections = new[]
        {
            new PromptSection("user", "A"),
            new PromptSection("system", "B")
        };
        prompt.Append(sections);
        Assert.Equal(2, prompt.Count);
        Assert.Equal("A", prompt[0].GetText());
        Assert.Equal("B", prompt[1].GetText());
    }

    [Fact]
    public void Append_Prompt_AddsAllSections()
    {
        var prompt1 = new Prompt();
        prompt1.Append("Hello");
        var prompt2 = new Prompt();
        prompt2.Append("World");
        prompt1.Append(prompt2);
        Assert.Equal(2, prompt1.Count);
        Assert.Equal("Hello", prompt1[0].GetText());
        Assert.Equal("World", prompt1[1].GetText());
    }

    [Fact]
    public void Last_ReturnsLastSectionOrNull()
    {
        var prompt = new Prompt();
        Assert.Null(prompt.Last());
        var section = new PromptSection("user", "Hello");
        prompt.Append(section);
        Assert.Equal(section, prompt.Last());
    }

    [Fact]
    public void JoinSections_ConcatenatesSections()
    {
        var prompt = new Prompt();
        prompt.Append("A");
        prompt.Append("B");
        var sb = prompt.JoinSections(",", false);
        Assert.Equal("A,B,", sb.ToString());
    }

    [Fact]
    public void JoinSections_IncludeSource_ConcatenatesWithSource()
    {
        var prompt = new Prompt();
        prompt.AppendInstruction("Do");
        prompt.Append("Say");
        var sb = prompt.JoinSections("|", true);
        Assert.Contains("system:", sb.ToString());
        Assert.Contains("user:", sb.ToString());
    }

    [Fact]
    public void ToString_ConcatenatesSections()
    {
        var prompt = new Prompt();
        prompt.Append("A");
        prompt.Append("B");
        Assert.Equal("A\nB\n", prompt.ToString());
    }

    [Fact]
    public void ToString_IncludeSource_ConcatenatesWithSource()
    {
        var prompt = new Prompt();
        prompt.AppendInstruction("Do");
        prompt.Append("Say");
        var result = prompt.ToString(true);
        Assert.Contains("system:", result);
        Assert.Contains("user:", result);
    }

    [Fact]
    public void GetLength_ReturnsTotalLength()
    {
        var prompt = new Prompt();
        prompt.Append("A");
        prompt.Append("BC");
        Assert.Equal(3, prompt.GetLength());
    }

    [Fact]
    public void ImplicitOperator_PromptFromString()
    {
        Prompt prompt = "Hello";
        Assert.Single(prompt);
        Assert.Equal("Hello", prompt[0].GetText());
    }

    [Fact]
    public void ImplicitOperator_StringFromPrompt()
    {
        var prompt = new Prompt();
        prompt.Append("Hello");
        string result = prompt;
        Assert.Equal("Hello\n", result);
    }

    [Fact]
    public void OperatorPlus_AppendsSection()
    {
        var prompt = new Prompt();
        var section = new PromptSection("user", "Hello");
        var result = prompt + section;
        Assert.Single(result);
        Assert.Equal(section, result[0]);
    }
}
