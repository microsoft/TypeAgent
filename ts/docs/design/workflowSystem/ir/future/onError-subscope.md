# onError as WorkflowScope (sub-scope target)

**Status**: Future consideration (v2+)

## Motivation

Today, `onError` targets a single task node. Recovery logic is confined to
one task invocation, which makes multi-step recovery awkward. Users must
chain multiple nodes manually (recovery node -> next -> next) from that single
entry point.

A more natural design would allow `onError` to target a **WorkflowScope**
(the same construct used by loop bodies, branch arms, and fork bodies). This
would give recovery handlers their own sub-scope with:

- A private namespace for intermediate bindings
- Multiple nodes with their own sequencing
- A dedicated `entry` and `output` template

## Proposal

```jsonc
// node.onError may reference a scope inline or by name
"fetchCalendar": {
    "kind": "task",
    "task": "calendar.fetch",
    ...
    "onError": {
        // WorkflowScope
        "inputSchema": { "type": "object" },
        "entry": "logError",
        "output": { "$from": "scope", "name": "placeholder" },
        "nodes": {
            "logError": { ... , "next": "makePlaceholder" },
            "makePlaceholder": { ... , "bind": "placeholder" }
        }
    }
}
```

## Design considerations

### Recovery namespace injection

The `$from: "recovery"` namespace (error, trigger) is injected at the
scope boundary. All nodes within the onError scope can access it, not just
the entry node. This is consistent with how `$from: "input"` works for
regular scopes.

### Bind-name sharing

When onError targets a single node, that node's `bind` name enters the
parent scope's binding map. With a sub-scope, the scope's `output` template
produces the value that gets bound into the parent scope under the original
node's `bind` name. This matches how loop bodies and branch arms already
work.

### Generalization: any WorkflowScope as a task target

The same mechanism that allows onError to target a WorkflowScope could
generalize to other places where a task reference appears:

- **Loop body onError**: the loop body's internal error handler could be a
  scope rather than a single node.
- **Fork/branch arm onError**: each arm could have its own recovery scope.
- **Top-level node replacement**: a node `kind: "scope"` (inline
  WorkflowScope) could replace a task node anywhere in the graph.

This would unify the "scope as computation" pattern and eliminate the need
for special-purpose constructs.

### Breaking changes

This would break the current constraint that `onError` is a `string`
(node ID). The IR type would need to change to:

```typescript
onError?: string | WorkflowScope;
```

The validator, engine, and emitter would all need updates to handle the
scope variant.

## Relationship to current design

The current `$from: "recovery"` namespace (implemented in v1) provides
the minimal correct mechanism: recovery data is isolated from the input
namespace, preventing silent shadowing. The sub-scope proposal builds on
this foundation by giving recovery handlers their own full execution
context rather than being limited to a single task.

## Open questions

1. Should the recovery scope inherit the parent's `$from: "state"`?
   (Relevant only when the failing node is inside a loop body.)
2. Should the recovery scope be able to "retry" the original node?
   (This would require a special output convention or a retry directive.)
3. Should sub-scope recovery compose with the existing
   "no recursive recovery" rule? (Probably yes - nodes inside a recovery
   scope should not themselves declare onError in v2 either.)
