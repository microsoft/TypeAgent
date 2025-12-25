// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using Xunit;

namespace Microsoft.TypeChat.Tests;

public class ArgumentVerifyTests
{
    [Fact]
    public void Throw_ThrowsArgumentException_WithMessage()
    {
        var ex = Assert.Throws<ArgumentException>(() => ArgumentVerify.Throw("test message"));
        Assert.Equal("test message", ex.Message);
    }

    [Fact]
    public void ThrowIfNull_WithNull_ThrowsArgumentNullException()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNull(null, "param"));
        Assert.Equal("param", ex.ParamName);
    }

    [Fact]
    public void ThrowIfNull_WithNonNull_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfNull(new object(), "param");
    }

    [Fact]
    public void ThrowIfNullOrEmpty_StringNull_ThrowsArgumentNullException()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNullOrEmpty((string)null, "param"));
        Assert.Equal("param", ex.ParamName);
    }

    [Fact]
    public void ThrowIfNullOrEmpty_StringEmpty_ThrowsArgumentException()
    {
        var ex = Assert.Throws<ArgumentException>(() => ArgumentVerify.ThrowIfNullOrEmpty("", "param"));
        Assert.Equal("The value cannot be an empty string. (Parameter 'param')", ex.Message);
    }

    [Fact]
    public void ThrowIfNullOrEmpty_StringValid_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfNullOrEmpty("valid", "param");
    }

    [Fact]
    public void ThrowIfNullOrEmpty_ListNull_ThrowsArgumentNullException()
    {
        List<int> list = null;
        var ex = Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNullOrEmpty(list, "param"));
        Assert.Equal("param", ex.ParamName);
    }

    [Fact]
    public void ThrowIfNullOrEmpty_ListEmpty_ThrowsArgumentException()
    {
        var ex = Assert.Throws<ArgumentException>(() => ArgumentVerify.ThrowIfNullOrEmpty(new List<int>(), "param"));
        Assert.Equal("The list cannot be empty. (Parameter 'param')", ex.Message);
    }

    [Fact]
    public void ThrowIfNullOrEmpty_ListValid_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfNullOrEmpty(new List<int> { 1 }, "param");
    }
}
