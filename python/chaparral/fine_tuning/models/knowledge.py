from dataclasses import dataclass
from typing import List, Literal

@dataclass
class Quantity:
    amount: float
    units: str

@dataclass
class Value:
    value: str | int | bool | Quantity

@dataclass
class Facet:
    name: str
    value: Value

@dataclass
class VerbTense:
    tense: Literal["past", "present", "future"]

@dataclass 
class ActionParam:
    name: str
    value: Value

@dataclass
class Action:
    verbs: List[str]
    verbTense: VerbTense
    subjectEntityName: str = "none"
    objectEntityName: str = "none"
    indirectObjectEntityName: str = "none"
    params: List[str | ActionParam] | None = None
    subjectEntityFacet: Facet | None = None

@dataclass
class ConcreteEntity:
    name: str
    type: str
    facets: List[Facet] | None = None

@dataclass
class KnowledgeResponse:
    entities: List[ConcreteEntity]
    actions: List[Action]
    topics: List[str]
    inverseActions: List[Action] | None = None