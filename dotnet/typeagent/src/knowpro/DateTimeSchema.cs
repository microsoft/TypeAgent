// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class DateVal
{
    [JsonPropertyName("day")]
    public int Day { get; set; }

    [JsonPropertyName("month")]
    public int Month { get; set; }

    [JsonPropertyName("year")]
    public int Year { get; set; }
}

public class TimeVal
{
    // In 24 hour form
    [Comment("In 24 hour form")]
    [JsonPropertyName("hour")]
    public int Hour { get; set; }

    [JsonPropertyName("minute")]
    public int Minute { get; set; }

    [JsonPropertyName("seconds")]
    public int Seconds { get; set; }
}

public class DateTime
{
    [JsonPropertyName("date")]
    public DateVal Date { get; set; }

    [JsonPropertyName("time")]
    public TimeVal? Time { get; set; }
}

public class DateTimeRange
{
    [JsonPropertyName("startDate")]
    public DateTime StartDate { get; set; }

    [JsonPropertyName("stopDate")]
    public DateTime? StopDate { get; set; }
}
