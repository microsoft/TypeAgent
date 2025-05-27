# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Literal

from pydantic.dataclasses import dataclass

from typeagent.knowpro.interfaces import SearchTerm


@dataclass
class SearchTermGroup:
    """A group of search terms.

    'boolean_op' is a boolean-like operator that instructs the query engine how to combine the queries in 'terms'.
    'terms' is a list of queries, either atomic (SearchTerm) or compound (SearchTermGroup).
    """

    boolean_op: Literal["and", "or", "or_max"]
    terms: list["SearchTermGroupTypes"]


SearchTermGroupTypes = SearchTerm | SearchTermGroup  # I.e., without PropertySearchTerm
