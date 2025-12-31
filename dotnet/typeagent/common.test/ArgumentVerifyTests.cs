// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;
using Xunit;

namespace common.test;

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

    [Fact]
    public void ThrowIfNotEqual_WithEqualValues_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfNotEqual(5, 5, "param");
    }

    [Fact]
    public void ThrowIfNotEqual_WithUnequalValues_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfNotEqual(3, 5, "param"));
        Assert.Contains("The value 3 must be < 5", ex.Message);
    }

    [Fact]
    public void ThrowIfGreaterThanEqual_WithLessThanValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfGreaterThanEqual(3, 5, "param");
    }

    [Fact]
    public void ThrowIfGreaterThanEqual_WithEqualValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfGreaterThanEqual(5, 5, "param"));
        Assert.Contains("The value must be < 5", ex.Message);
    }

    [Fact]
    public void ThrowIfGreaterThanEqual_WithGreaterValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfGreaterThanEqual(7, 5, "param"));
        Assert.Contains("The value must be < 5", ex.Message);
    }

    [Fact]
    public void ThrowIfGreaterThan_WithLessThanValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfGreaterThan(3, 5, "param");
    }

    [Fact]
    public void ThrowIfGreaterThan_WithEqualValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfGreaterThan(5, 5, "param");
    }

    [Fact]
    public void ThrowIfGreaterThan_WithGreaterValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfGreaterThan(7, 5, "param"));
        Assert.Contains("The value must be <= 5", ex.Message);
    }

    [Fact]
    public void ThrowIfLessThan_WithGreaterValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfLessThan(7, 5, "param");
    }

    [Fact]
    public void ThrowIfLessThan_WithEqualValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfLessThan(5, 5, "param");
    }

    [Fact]
    public void ThrowIfLessThan_WithLessThanValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfLessThan(3, 5, "param"));
        Assert.Contains("The value must be < 5", ex.Message);
    }

    [Fact]
    public void ThrowIfLessThanEqual_WithGreaterValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfLessThanEqual(7, 5, "param");
    }

    [Fact]
    public void ThrowIfLessThanEqual_WithEqualValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfLessThanEqual(5, 5, "param"));
        Assert.Contains("The value must be > 5", ex.Message);
    }

    [Fact]
    public void ThrowIfLessThanEqual_WithLessThanValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfLessThanEqual(3, 5, "param"));
        Assert.Contains("The value must be > 5", ex.Message);
    }

    [Fact]
    public void ThrowIfLessThanEqualZero_WithPositiveValue_DoesNotThrow()
    {
        ArgumentVerify.ThrowIfLessThanEqualZero(5, "param");
    }

    [Fact]
    public void ThrowIfLessThanEqualZero_WithZero_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfLessThanEqualZero(0, "param"));
        Assert.Contains("The value must be > 0", ex.Message);
    }

    [Fact]
    public void ThrowIfLessThanEqualZero_WithNegativeValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => ArgumentVerify.ThrowIfLessThanEqualZero(-1, "param"));
        Assert.Contains("The value must be > 0", ex.Message);
    }
}
