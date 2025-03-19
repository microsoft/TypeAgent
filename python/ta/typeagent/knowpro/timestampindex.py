# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


from .interfaces import ITimestampToTextRangeIndex, TimestampedTextRange, DateRange

class TimestampToTextRangeIndex(ITimestampToTextRangeIndex):
    _ranges: list[TimestampedTextRange]

    def __init__(self):
        self._ranges = []

    def lookup_range(self, date_range: DateRange):
        start_at = self.date_to_timestamp(date_range.start)
        stop_at = None if date_range.end is None else self.date_to_timestamp(date_range.end)
        return get_in_range(
            self._ranges,
            start_at,
            stop_at,
            lambda x, y: 0 if x.timestamp == y else (1 if x.timestamp > y else -1),
        )
    

def get_in_range(values: list[Any], start_at: Any, stop_at: Any | None,
                 compare: Callable[[Any, Any], int