# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


import bisect
from typing import Any, Callable

from .interfaces import (
    ITimestampToTextRangeIndex,
    TimestampedTextRange,
    DateRange,
)


class TimestampToTextRangeIndex(ITimestampToTextRangeIndex):
    def __init__(self):
        self._ranges: list[TimestampedTextRange] = []

    def lookup_range(self, date_range: DateRange):
        start_at = date_range.start.isoformat()
        stop_at = None if date_range.end is None else date_range.end.isoformat()
        return get_in_range(
            self._ranges,
            start_at,
            stop_at,
            key=lambda x: x.timestamp,
        )


def get_in_range[T, S: Any](
    values: list[T],
    start_at: S,
    stop_at: S | None,
    key: Callable[[T], S],
) -> list[T]:
    istart = bisect.bisect_left(values, start_at, key=key)
    if istart == len(values):
        return []
    if stop_at is None:
        return values[istart:]
    istop = bisect.bisect_right(values, stop_at, istart, key=key)
    # If istop has a value that matches the range, use it.
    if istop < len(values) and key(values[istop]) == stop_at:
        return values[istart : istop + 1]
    else:
        return values[istart:istop]
