// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Globalization;
using System.Text;
using System.Text.Json;
using TypeAgent.Common;

namespace common.test;

public class IsoDateJsonConverterTests
{
    private readonly JsonSerializerOptions _options;

    public IsoDateJsonConverterTests()
    {
        _options = new JsonSerializerOptions();
        _options.Converters.Add(new IsoDateJsonConverter());
    }

    [Fact]
    public void Write_SerializesDateTimeOffset_ToIso8601Format()
    {
        // Arrange
        var dateTime = new DateTimeOffset(2025, 11, 5, 14, 23, 17, 123, TimeSpan.Zero);

        // Act
        string json = JsonSerializer.Serialize(dateTime, _options);

        // Assert
        Assert.Contains("2025-11-05T14:23:17", json);
    }

    [Fact]
    public void Read_DeserializesValidIso8601String_ToDateTimeOffset()
    {
        // Arrange
        string json = "\"2025-11-05T14:23:17.1234567+00:00\"";

        // Act
        var result = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

        // Assert
        Assert.Equal(2025, result.Year);
        Assert.Equal(11, result.Month);
        Assert.Equal(5, result.Day);
        Assert.Equal(14, result.Hour);
        Assert.Equal(23, result.Minute);
        Assert.Equal(17, result.Second);
    }

    [Fact]
    public void Read_DeserializesDateWithTimezone_PreservesOffset()
    {
        // Arrange
        string json = "\"2025-06-15T10:30:00+05:30\"";

        // Act
        var result = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

        // Assert
        Assert.Equal(new TimeSpan(5, 30, 0), result.Offset);
    }

    [Fact]
    public void Read_DeserializesUtcDate_ReturnsUtcOffset()
    {
        // Arrange
        string json = "\"2025-12-31T23:59:59Z\"";

        // Act
        var result = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

        // Assert
        Assert.Equal(TimeSpan.Zero, result.Offset);
        Assert.Equal(12, result.Month);
        Assert.Equal(31, result.Day);
    }

    [Fact]
    public void Read_ThrowsJsonException_ForEmptyString()
    {
        // Arrange
        string json = "\"\"";

        // Act & Assert
        var ex = Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<DateTimeOffset>(json, _options));
        Assert.Contains("Invalid DateTimeOffset value", ex.Message);
    }

    [Fact]
    public void Read_ThrowsJsonException_ForInvalidDateString()
    {
        // Arrange
        string json = "\"not-a-valid-date\"";

        // Act & Assert
        var ex = Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<DateTimeOffset>(json, _options));
        Assert.Contains("Invalid DateTimeOffset value", ex.Message);
    }

    [Fact]
    public void Read_ThrowsJsonException_ForNonStringToken()
    {
        // Arrange
        string json = "12345";

        // Act & Assert
        var ex = Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<DateTimeOffset>(json, _options));
        Assert.Contains("Invalid DateTimeOffset value", ex.Message);
    }

    [Fact]
    public void RoundTrip_SerializeAndDeserialize_PreservesValue()
    {
        // Arrange
        var original = new DateTimeOffset(2025, 7, 4, 12, 0, 0, TimeSpan.FromHours(-5));

        // Act
        string json = JsonSerializer.Serialize(original, _options);
        var deserialized = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

        // Assert
        Assert.Equal(original.UtcDateTime, deserialized.UtcDateTime);
    }

    [Fact]
    public void Read_DeserializesSimpleDateFormat_Successfully()
    {
        // Arrange
        string json = "\"2025-03-15\"";

        // Act
        var result = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

        // Assert
        Assert.Equal(2025, result.Year);
        Assert.Equal(3, result.Month);
        Assert.Equal(15, result.Day);
    }

    [Fact]
    public void Write_SerializesObjectWithDateTimeOffsetProperty()
    {
        // Arrange
        var options = new JsonSerializerOptions();
        options.Converters.Add(new IsoDateJsonConverter());
        var testObj = new TestDateObject
        {
            Timestamp = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero)
        };

        // Act
        string json = JsonSerializer.Serialize(testObj, options);

        // Assert
        Assert.Contains("2025-01-01T00:00:00", json);
    }

    [Fact]
    public void Read_DeserializesObjectWithDateTimeOffsetProperty()
    {
        // Arrange
        var options = new JsonSerializerOptions();
        options.Converters.Add(new IsoDateJsonConverter());
        string json = "{\"Timestamp\":\"2025-08-20T15:45:30+00:00\"}";

        // Act
        var result = JsonSerializer.Deserialize<TestDateObject>(json, options);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2025, result.Timestamp.Year);
        Assert.Equal(8, result.Timestamp.Month);
        Assert.Equal(20, result.Timestamp.Day);
    }

    private class TestDateObject
    {
        public DateTimeOffset Timestamp { get; set; }
    }
}
