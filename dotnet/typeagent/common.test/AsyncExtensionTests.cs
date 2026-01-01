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

public class AsyncExtensionTests
{
    #region Task.WaitForResult (void)

    [Fact]
    public void WaitForResult_Task_CompletedTask_DoesNotThrow()
    {
        // Arrange
        Task task = Task.CompletedTask;

        // Act & Assert - Should not throw
        task.WaitForResult();
    }

    [Fact]
    public async Task WaitForResult_Task_DelayedTask_WaitsForCompletion()
    {
        // Arrange
        bool completed = false;
        Task task = Task.Run(async () =>
        {
            await Task.Delay(50);
            completed = true;
        });

        // Act
        task.WaitForResult();

        // Assert
        Assert.True(completed);
    }

    [Fact]
    public void WaitForResult_Task_FaultedTask_ThrowsOriginalException()
    {
        // Arrange
        var expectedException = new InvalidOperationException("Test exception");
        Task task = Task.FromException(expectedException);

        // Act & Assert
        var exception = Assert.Throws<InvalidOperationException>(() => task.WaitForResult());
        Assert.Equal(expectedException.Message, exception.Message);
    }

    #endregion

    #region Task<T>.WaitForResult

    [Fact]
    public void WaitForResult_TaskT_CompletedTask_ReturnsValue()
    {
        // Arrange
        const int expected = 42;
        Task<int> task = Task.FromResult(expected);

        // Act
        int result = task.WaitForResult();

        // Assert
        Assert.Equal(expected, result);
    }

    [Fact]
    public void WaitForResult_TaskT_DelayedTask_WaitsAndReturnsValue()
    {
        // Arrange
        const string expected = "Hello, World!";
        Task<string> task = Task.Run(async () =>
        {
            await Task.Delay(50);
            return expected;
        });

        // Act
        string result = task.WaitForResult();

        // Assert
        Assert.Equal(expected, result);
    }

    [Fact]
    public void WaitForResult_TaskT_FaultedTask_ThrowsOriginalException()
    {
        // Arrange
        var expectedException = new ArgumentException("Invalid argument");
        Task<int> task = Task.FromException<int>(expectedException);

        // Act & Assert
        var exception = Assert.Throws<ArgumentException>(() => task.WaitForResult());
        Assert.Equal(expectedException.Message, exception.Message);
    }

    [Fact]
    public void WaitForResult_TaskT_ReturnsComplexObject()
    {
        // Arrange
        var expected = new List<string> { "a", "b", "c" };
        Task<List<string>> task = Task.FromResult(expected);

        // Act
        var result = task.WaitForResult();

        // Assert
        Assert.Equal(expected, result);
    }

    #endregion

    #region ValueTask.WaitForResult (void)

    [Fact]
    public void WaitForResult_ValueTask_CompletedTask_DoesNotThrow()
    {
        // Arrange
        ValueTask task = ValueTask.CompletedTask;

        // Act & Assert - Should not throw
        task.WaitForResult();
    }

    [Fact]
    public void WaitForResult_ValueTask_FromTask_WaitsForCompletion()
    {
        // Arrange
        bool completed = false;
        ValueTask task = new ValueTask(Task.Run(async () =>
        {
            await Task.Delay(50);
            completed = true;
        }));

        // Act
        task.WaitForResult();

        // Assert
        Assert.True(completed);
    }

    [Fact]
    public void WaitForResult_ValueTask_FaultedTask_ThrowsOriginalException()
    {
        // Arrange
        var expectedException = new InvalidOperationException("ValueTask exception");
        ValueTask task = new ValueTask(Task.FromException(expectedException));

        // Act & Assert
        var exception = Assert.Throws<InvalidOperationException>(() => task.WaitForResult());
        Assert.Equal(expectedException.Message, exception.Message);
    }

    #endregion

    #region ValueTask<T>.WaitForResult

    [Fact]
    public void WaitForResult_ValueTaskT_SynchronousValue_ReturnsValue()
    {
        // Arrange
        const int expected = 100;
        ValueTask<int> task = new ValueTask<int>(expected);

        // Act
        int result = task.WaitForResult();

        // Assert
        Assert.Equal(expected, result);
    }

    [Fact]
    public void WaitForResult_ValueTaskT_FromTask_WaitsAndReturnsValue()
    {
        // Arrange
        const double expected = 3.14159;
        ValueTask<double> task = new ValueTask<double>(Task.Run(async () =>
        {
            await Task.Delay(50);
            return expected;
        }));

        // Act
        double result = task.WaitForResult();

        // Assert
        Assert.Equal(expected, result);
    }

    [Fact]
    public void WaitForResult_ValueTaskT_FaultedTask_ThrowsOriginalException()
    {
        // Arrange
        var expectedException = new ArgumentNullException("param");
        ValueTask<string> task = new ValueTask<string>(Task.FromException<string>(expectedException));

        // Act & Assert
        var exception = Assert.Throws<ArgumentNullException>(() => task.WaitForResult());
        Assert.Equal(expectedException.ParamName, exception.ParamName);
    }

    [Fact]
    public void WaitForResult_ValueTaskT_ReturnsNullableValue()
    {
        // Arrange
        string? expected = null;
        ValueTask<string?> task = new ValueTask<string?>(expected);

        // Act
        string? result = task.WaitForResult();

        // Assert
        Assert.Null(result);
    }

    #endregion
}
