// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Common;
using Xunit;

namespace common.test;

public class MethodExtensionTests
{
    [Fact]
    public void SafeInvoke_NullAction_DoesNotThrow()
    {
        Action action = null;
        action.SafeInvoke();
    }

    [Fact]
    public void SafeInvoke_ValidAction_Invokes()
    {
        bool invoked = false;
        Action action = () => invoked = true;
        action.SafeInvoke();
        Assert.True(invoked);
    }

    [Fact]
    public void SafeInvoke_ActionThrows_DoesNotThrow()
    {
        Action action = () => throw new InvalidOperationException();
        action.SafeInvoke();
    }

    [Fact]
    public void SafeInvoke_T1_NullAction_DoesNotThrow()
    {
        Action<int> action = null;
        action.SafeInvoke(1);
    }

    [Fact]
    public void SafeInvoke_T1_ValidAction_Invokes()
    {
        int capturedValue = 0;
        Action<int> action = (x) => capturedValue = x;
        action.SafeInvoke(42);
        Assert.Equal(42, capturedValue);
    }

    [Fact]
    public void SafeInvoke_T1_ActionThrows_DoesNotThrow()
    {
        Action<int> action = (x) => throw new InvalidOperationException();
        action.SafeInvoke(1);
    }

    [Fact]
    public void SafeInvoke_T1T2_NullAction_DoesNotThrow()
    {
        Action<int, string> action = null;
        action.SafeInvoke(1, "test");
    }

    [Fact]
    public void SafeInvoke_T1T2_ValidAction_Invokes()
    {
        int capturedInt = 0;
        string capturedString = null;
        Action<int, string> action = (x, y) =>
        {
            capturedInt = x;
            capturedString = y;
        };
        action.SafeInvoke(42, "hello");
        Assert.Equal(42, capturedInt);
        Assert.Equal("hello", capturedString);
    }

    [Fact]
    public void SafeInvoke_T1T2_ActionThrows_DoesNotThrow()
    {
        Action<int, string> action = (x, y) => throw new InvalidOperationException();
        action.SafeInvoke(1, "test");
    }

    [Fact]
    public void SafeInvoke_T1T2T3_NullAction_DoesNotThrow()
    {
        Action<int, string, double> action = null;
        action.SafeInvoke(1, "test", 3.14);
    }

    [Fact]
    public void SafeInvoke_T1T2T3_ValidAction_Invokes()
    {
        int capturedInt = 0;
        string capturedString = null;
        double capturedDouble = 0;
        Action<int, string, double> action = (x, y, z) =>
        {
            capturedInt = x;
            capturedString = y;
            capturedDouble = z;
        };
        action.SafeInvoke(42, "hello", 3.14);
        Assert.Equal(42, capturedInt);
        Assert.Equal("hello", capturedString);
        Assert.Equal(3.14, capturedDouble);
    }

    [Fact]
    public void SafeInvoke_T1T2T3_ActionThrows_DoesNotThrow()
    {
        Action<int, string, double> action = (x, y, z) => throw new InvalidOperationException();
        action.SafeInvoke(1, "test", 3.14);
    }
}
