# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
from typing import List, Literal, Union

@dataclass
class Quantity:
    amount: float
    units: str

    @classmethod
    def from_dict(cls, data: dict):
        amount = data.get("amount", None)
        units = data.get("units", None)

        if amount == None:
            raise ValueError("Invalid quantity: missing amount")
        
        if units == None:
            raise ValueError("Invalid quantity: missing units")

        return cls(amount, units)
    
    @classmethod
    def is_valid(cls, data: dict):
        return "amount" in data and "units" in data
    
    def to_dict(self):
        return {
            "amount": self.amount,
            "units": self.units
        }

@dataclass
class Value:
    value: Union[str, int, bool, Quantity]

    @classmethod
    def from_raw(cls, raw_value: Union[str, int, bool, Quantity]):
        if isinstance(raw_value, (str, int, bool)):
            return cls(value=raw_value)
        elif isinstance(raw_value, dict) and Quantity.is_valid(raw_value):
            return cls(value=Quantity.from_dict(raw_value))
        else:
            raise ValueError(f"Unsupported value type: {type(raw_value)}")
        
    def to_dict(self):
        if isinstance(self.value, Quantity):
            return self.value.to_dict()
        else:
            return self.value

@dataclass
class Facet:
    name: str
    value: Value

    @classmethod
    def from_dict(cls, data: dict):
        name = data.get("name", None)
        value = data["value"]

        if name == None:
            raise ValueError("Invalid facet: missing name")

        if value == None:
            raise ValueError("Invalid facet: missing value")

        value = Value(value)

        return cls(name, value)
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value.to_dict()
        }

@dataclass
class VerbTense:
    tense: Literal["past", "present", "future"]

    def to_dict(self):
        return self.tense

@dataclass 
class ActionParam:
    name: str
    value: Value

    @classmethod
    def from_dict(cls, data: dict):
        name = data.get("name", None)
        value = data.get("value", None)

        if name == None:
            raise ValueError("Invalid action param: missing name")
        
        if value == None:
            raise ValueError("Invalid action param: missing value")

        value = Value(value)
        
        return cls(name, value)
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value.to_dict()
        }

@dataclass
class Action:
    verbs: List[str]
    verbTense: VerbTense
    subjectEntityName: str = "none"
    objectEntityName: str = "none"
    indirectObjectEntityName: str = "none"
    params: List[str | ActionParam] | None = None
    subjectEntityFacet: Facet | None = None

    @classmethod
    def from_dict(cls, data: dict):
        verbs = data.get("verbs", None)
        verbTense = data.get("verbTense", None)
        subjectEntityName = data.get("subjectEntityName", "none")
        objectEntityName = data.get("objectEntityName", "none")
        indirectObjectEntityName = data.get("indirectObjectEntityName", "none")
        params = data.get("params", None)
        subjectEntityFacet = data.get("subjectEntityFacet", None)

        if verbs == None:
            raise ValueError("Invalid action: missing verbs")
        
        if verbTense == None:
            raise ValueError("Invalid action: missing verbTense")
        
        if params:
            params = [ActionParam.from_dict(param) if isinstance(param, dict) else param for param in params]
        
        if subjectEntityFacet:
            subjectEntityFacet = Facet.from_dict(subjectEntityFacet)

        return cls(
            verbs, 
            VerbTense(verbTense), 
            subjectEntityName, 
            objectEntityName, 
            indirectObjectEntityName, 
            params, 
            subjectEntityFacet
        )
    
    def to_dict(self):
        params = []
        if self.params:
            for param in self.params:
                if isinstance(param, str):
                    params.append(param)
                else:
                    params.append(param.to_dict())

        return {
            "verbs": self.verbs,
            "verbTense": self.verbTense.to_dict(),
            "subjectEntityName": self.subjectEntityName,
            "objectEntityName": self.objectEntityName,
            "indirectObjectEntityName": self.indirectObjectEntityName,
            "params": params,
            "subjectEntityFacet": self.subjectEntityFacet.to_dict() if self.subjectEntityFacet else None
        }

@dataclass
class ConcreteEntity:
    name: str
    type: str
    facets: List[Facet] | None = None

    @classmethod
    def from_dict(cls, data: dict):
        name = data.get("name", None)
        type = data.get("type", None)
        facets = data.get("facets", None)

        if name == None:
            raise ValueError("Invalid entity: missing name")
        
        if type == None:
            raise ValueError("Invalid entity: missing type")

        if facets:
            facets = [Facet.from_dict(facet) for facet in facets]        

        return cls(name, type, facets)
    
    def to_dict(self):
        return {
            "name": self.name,
            "type": self.type,
            "facets": [facet.to_dict() for facet in self.facets] if self.facets else None
        }

@dataclass
class KnowledgeResponse:
    entities: List[ConcreteEntity]
    actions: List[Action]
    topics: List[str]
    inverseActions: List[Action] | None = None

    @classmethod
    def from_dict(cls, data: dict):
        entities = data.get("entities", None)
        actions = data.get("actions", None)
        topics = data.get("topics", None)
        inverseActions = data.get("inverseActions", None)

        if entities == None:
            raise ValueError("Invalid knowledge response: missing entities")
        
        if entities == None:
            raise ValueError("Invalid knowledge response: missing actions")
        
        if topics == None:
            raise ValueError("Invalid knowledge response: missing topics")
        
        entities = [ConcreteEntity.from_dict(entity) for entity in entities]
        actions = [Action.from_dict(action) for action in actions]

        if inverseActions:
            inverseActions = [Action.from_dict(action) for action in inverseActions]

        return cls(entities, actions, topics, inverseActions)
    
    def to_dict(self):

        inverse_actions = []
        if self.inverseActions:
            for action in self.inverseActions:
                inverse_actions.append(action.to_dict())

        return {
            "entities": [entity.to_dict() for entity in self.entities],
            "actions": [action.to_dict() for action in self.actions],
            "topics": self.topics,
            "inverseActions": inverse_actions
        }
    
    def to_str(self):
        return str(self.to_dict())
