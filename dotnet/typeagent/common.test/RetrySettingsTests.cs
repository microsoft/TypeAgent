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

public class RetrySettingsTests
{
    [Fact]
    public void DefaultConstructor_SetsDefaultValues()
    {
        var settings = new RetrySettings();

        Assert.Equal(3, settings.MaxRetries);
        Assert.Equal(1000, settings.RetryPauseMs);
        Assert.Equal(-1, settings.MaxRetryPauseMs);
        Assert.Equal(0.5, settings.JitterRange);
    }

    [Fact]
    public void Constructor_WithMaxRetries_SetsMaxRetries()
    {
        var settings = new RetrySettings(5);

        Assert.Equal(5, settings.MaxRetries);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Constructor_WithInvalidMaxRetries_ThrowsArgumentOutOfRangeException(int maxRetries)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new RetrySettings(maxRetries));
    }

    [Fact]
    public void ThrowIfInvalid_WithValidMaxRetries_DoesNotThrow()
    {
        var settings = new RetrySettings { MaxRetries = 30 };

        settings.ThrowIfInvalid();
    }

    [Fact]
    public void ThrowIfInvalid_WithMaxRetriesGreaterThan30_ThrowsArgumentOutOfRangeException()
    {
        var settings = new RetrySettings { MaxRetries = 31 };

        Assert.Throws<ArgumentOutOfRangeException>(() => settings.ThrowIfInvalid());
    }

    [Fact]
    public void AdjustRetryPauseMs_WithNoJitter_ReturnsSameValue()
    {
        var settings = new RetrySettings { JitterRange = 0 };

        int result = settings.AdjustRetryPauseMs(1000);

        Assert.Equal(1000, result);
    }

    [Fact]
    public void AdjustRetryPauseMs_WithJitterOutOfRange_ReturnsSameValue()
    {
        var settings = new RetrySettings { JitterRange = 1.5 };

        int result = settings.AdjustRetryPauseMs(1000);

        Assert.Equal(1000, result);
    }

    [Fact]
    public void AdjustRetryPauseMs_WithValidJitter_ReturnsValueWithinRange()
    {
        var settings = new RetrySettings { JitterRange = 0.5 };

        // Run multiple times to account for randomness
        for (int i = 0; i < 100; i++)
        {
            int result = settings.AdjustRetryPauseMs(1000);

            // With 0.5 jitter range, the result should be between 750 and 1250 (1000 * (0.75 to 1.25))
            Assert.InRange(result, 750, 1250);
        }
    }

    [Fact]
    public void AdjustRetryPauseMs_WithMaxRetryPauseMs_CapsAtMaximum()
    {
        var settings = new RetrySettings
        {
            JitterRange = 0,
            MaxRetryPauseMs = 500
        };

        int result = settings.AdjustRetryPauseMs(1000);

        Assert.Equal(500, result);
    }

    [Fact]
    public void AdjustRetryPauseMs_WithMaxRetryPauseMsZeroOrNegative_DoesNotCap()
    {
        var settings = new RetrySettings
        {
            JitterRange = 0,
            MaxRetryPauseMs = -1
        };

        int result = settings.AdjustRetryPauseMs(1000);

        Assert.Equal(1000, result);
    }

    [Fact]
    public void AdjustRetryPauseMs_WithJitterAndMaxPause_AppliesBothConstraints()
    {
        var settings = new RetrySettings
        {
            JitterRange = 0.5,
            MaxRetryPauseMs = 800
        };

        // Run multiple times to account for randomness
        for (int i = 0; i < 100; i++)
        {
            int result = settings.AdjustRetryPauseMs(1000);

            // Result should never exceed MaxRetryPauseMs
            Assert.True(result <= 800);
            // Result should be at least 750 (min jitter) or whatever is capped
            Assert.True(result >= 750);
        }
    }

    [Fact]
    public void Properties_CanBeSetAndRetrieved()
    {
        var settings = new RetrySettings
        {
            MaxRetries = 10,
            RetryPauseMs = 2000,
            MaxRetryPauseMs = 5000,
            JitterRange = 0.3
        };

        Assert.Equal(10, settings.MaxRetries);
        Assert.Equal(2000, settings.RetryPauseMs);
        Assert.Equal(5000, settings.MaxRetryPauseMs);
        Assert.Equal(0.3, settings.JitterRange);
    }
}
