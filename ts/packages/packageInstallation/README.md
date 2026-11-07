# @typeagent/package-installation

Shared npm acquisition and the memory-view installation lifecycle, without the
private default agent provider or its bundled agents.

```typescript
import { createMemoryViewPackageManager } from "@typeagent/package-installation";

const manager = createMemoryViewPackageManager({
  directory: absoluteInventoryDirectory,
  sources: [{ name: "local", kind: "path" }],
});
const installed = await manager.install(absolutePackageDirectory);
const providers = await manager.load(installed.name, [
  { providerId, context: hostCapabilities },
]);
```

The manager retains path/catalog/feed acquisition, a separate locked atomic
inventory, exact asset fingerprints and explicit activation. Installation does
not import provider code, grant source access, call models or publish Views.
Only trusted packages should be activated; execution is not sandboxed.

The `./sources/*` exports provide the same acquisition contracts and npm source
implementations used by ordinary agents. MCP configuration and registry
implementations remain host-owned: supply a source factory to the shared
registry. `./mcp-types` contains only the shared configuration types, not MCP
execution, credentials or policy.

The private default agent provider retains compatibility exports and injects its
MCP source implementations. It depends on this package, never the reverse.
Publish this package with the matching memory-service release before updating
external consumers. A release predating this extraction cannot provide it.
