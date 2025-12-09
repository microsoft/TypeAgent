// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using TypeAgent.KnowPro;

namespace common.test;
public class DateTimeTests
{
    [Fact]
    public void DateTimeNotNullOffsetTests()
    {
        TypeAgent.KnowPro.DateTime dt = new TypeAgent.KnowPro.DateTime();

        dt.Date = new TypeAgent.KnowPro.DateVal()
        {
            Day = 1,
            Month = 5,
            Year = 1941
        };

        dt.Time = new TypeAgent.KnowPro.TimeVal()
        {
            Hour = 2,
            Minute = 5,
            Seconds = 59
        };

        DateTimeOffset offset = dt.ToDateTimeOffset();
        Assert.Equal(1, offset.Day);
        Assert.Equal(5, offset.Month);
        Assert.Equal(1941, offset.Year);
        Assert.Equal(2, offset.Hour);
        Assert.Equal(5, offset.Minute);
        Assert.Equal(59, offset.Second);

        DateTimeOffset startDate = dt.ToStartDate();
        Assert.Equal(1, startDate.Day);
        Assert.Equal(5, startDate.Month);
        Assert.Equal(1941, startDate.Year);
        Assert.Equal(2, startDate.Hour);
        Assert.Equal(5, startDate.Minute);
        Assert.Equal(59, startDate.Second);

        DateTimeOffset stopDate = dt.ToStopDate();
        Assert.Equal(1, stopDate.Day);
        Assert.Equal(5, stopDate.Month);
        Assert.Equal(1941, stopDate.Year);
        Assert.Equal(2, stopDate.Hour);
        Assert.Equal(5, stopDate.Minute);
        Assert.Equal(59, stopDate.Second);
    }

    [Fact]
    public void DateTimeNullOffsetTests()
    {
        TypeAgent.KnowPro.DateTime dt = new TypeAgent.KnowPro.DateTime();

        dt.Date = new TypeAgent.KnowPro.DateVal()
        {
            Day = 1,
            Month = 5,
            Year = 1941
        };

        DateTimeOffset offset = dt.ToDateTimeOffset();
        Assert.Equal(1, offset.Day);
        Assert.Equal(5, offset.Month);
        Assert.Equal(1941, offset.Year);
        Assert.Equal(0, offset.Hour);
        Assert.Equal(0, offset.Minute);
        Assert.Equal(0, offset.Second);

        DateTimeOffset startDate = dt.ToStartDate();
        Assert.Equal(1, startDate.Day);
        Assert.Equal(5, startDate.Month);
        Assert.Equal(1941, startDate.Year);
        Assert.Equal(0, startDate.Hour);
        Assert.Equal(0, startDate.Minute);
        Assert.Equal(0, startDate.Second);

        DateTimeOffset stopDate = dt.ToStopDate();
        Assert.Equal(1, stopDate.Day);
        Assert.Equal(5, stopDate.Month);
        Assert.Equal(1941, stopDate.Year);
        Assert.Equal(23, stopDate.Hour);
        Assert.Equal(59, stopDate.Minute);
        Assert.Equal(59, stopDate.Second);
        Assert.Equal(999, stopDate.Millisecond);
    }

    [Fact]
    public void DateTimeRangeTests()
    {
        DateTimeRange dtr = new DateTimeRange()
        {
            StartDate = new TypeAgent.KnowPro.DateTime()
            {
                Date = new TypeAgent.KnowPro.DateVal()
                {
                    Day = 1,
                    Month = 1,
                    Year = 1900

                }
            },
            StopDate = new TypeAgent.KnowPro.DateTime()
            {
                Date = new TypeAgent.KnowPro.DateVal()
                {
                    Day = 1,
                    Month = 1,
                    Year = 1900

                }
            },
        };

        DateRange range = dtr.ToDateRange();

        Assert.Equal(range.Start.Day, dtr.StartDate.Date.Day);
        Assert.Equal(range.Start.Month, dtr.StartDate.Date.Month);
        Assert.Equal(range.Start.Year, dtr.StartDate.Date.Year);
    }
}
