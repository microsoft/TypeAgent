// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public partial class DateTime
{
    public DateTimeOffset ToDateTimeOffset()
    {
        return Time is not null
            ? new DateTimeOffset(
                Date.Year,
                Date.Month,
                Date.Day,
                Time.Hour,
                Time.Minute,
                Time.Seconds,
                TimeSpan.Zero
            )
            : new DateTimeOffset(
            Date.Year,
            Date.Month,
            Date.Day,
            0,
            0,
            0,
            TimeSpan.Zero
        );
    }

    // Instance version of former toStartDate(dateTime).
    public DateTimeOffset ToStartDate()
    {
        return Time is not null
            ? ToDateTimeOffset()
            : new DateTimeOffset(
            Date.Year,
            Date.Month,
            Date.Day,
            0,
            0,
            0,
            TimeSpan.Zero
        );
    }

    // Instance version of former toStopDate(dateTime).
    // If no time component, returns inclusive end-of-day (23:59:59.999).
    public DateTimeOffset ToStopDate()
    {
        return Time is not null
            ? ToDateTimeOffset()
            : new DateTimeOffset(
            Date.Year,
            Date.Month,
            Date.Day,
            23,
            59,
            59,
            TimeSpan.Zero
        ).AddMilliseconds(999);
    }
}

public partial class DateTimeRange
{
    public DateRange ToDateRange()
    {
        var start = StartDate.ToStartDate();
        var end = StopDate is not null ? StopDate.ToStopDate() : (DateTimeOffset?)null;

        return new DateRange
        {
            Start = start,
            End = end
        };
    }
}
