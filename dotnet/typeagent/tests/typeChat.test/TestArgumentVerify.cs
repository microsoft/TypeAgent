// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Microsoft.TypeChat.Tests;

public class TestArgumentVerify
{
    [Fact]
    public void TestThrow()
    {
        Assert.Throws<ArgumentException>(() => ArgumentVerify.Throw("Throw this message!"));
    }

    [Fact]
    public void TestThrowIfNull()
    {
        ArgumentVerify.ThrowIfNull("", "testparam");

        Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNull(null, "testparam"));
    }

    [Fact]
    public void TestThrowIfNullOrEmpty()
    {
        ArgumentVerify.ThrowIfNullOrEmpty("asdfdsf", "testparam");

        Assert.Throws<ArgumentException>(() => ArgumentVerify.ThrowIfNullOrEmpty("", "testparam"));
        Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNullOrEmpty(null, "testparam"));
    }

    [Fact]
    public void TestThrowIfNullOrEmptyIList()
    {
        ArgumentVerify.ThrowIfNullOrEmpty<string>(["test"], "testparam");

        Assert.Throws<ArgumentException>(() => ArgumentVerify.ThrowIfNullOrEmpty(Array.Empty<string>(), "testparam"));
        Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNullOrEmpty(null, "testparam"));
    }
}
