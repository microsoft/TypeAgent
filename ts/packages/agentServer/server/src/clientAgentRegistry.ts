// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    SessionContext,
} from "@typeagent/agent-sdk";
import { createHash } from "node:crypto";
import { createLimiter } from "@typeagent/common-utils";
import registerDebug from "debug";

const debugGroup = registerDebug("agent-server:clientAgent");
const debugRoute = registerDebug("agent-server:clientAgent:route");

/**
 * One client (a phone, a shell, a browser extension) hosting the agent. The
 * proxy talks back over that client's connection, so an instance dies with it.
 */
export type ClientAgentInstance = {
    instanceId: string;
    displayName: string;
    connectionId: string;
    appAgent: AppAgent;
    registeredAt: number;
    lastUsed: number;
};

/**
 * All the clients hosting one agent name on one conversation. The dispatcher
 * only sees {@link ClientAgentGroup.mux}, registered once for the whole group.
 */
export type ClientAgentGroup = {
    name: string;
    manifest: AppAgentManifest;
    /** Hash of the schema source; instances must agree on it. See {@link getManifestKey}. */
    manifestKey: string;
    /**
     * Whether the client that created this group opted in to sharing the name.
     * Off means a second, different client is rejected exactly as it was before
     * groups existed, so a client that assumes it is the only host of the name
     * (the shell) is unaffected by this whole mechanism.
     */
    multiInstance: boolean;
    instances: Map<string, ClientAgentInstance>;
    mux: AppAgent;
};

export type ClientAgentRegistration = {
    instanceId: string;
    displayName: string;
    connectionId: string;
    appAgent: AppAgent;
    manifest: AppAgentManifest;
    /** See {@link ClientAgentGroup.multiInstance}. Only read on the first registration. */
    multiInstance?: boolean;
};

/** The message a second client gets when the group is not shared. */
export function agentAlreadyExistsMessage(name: string): string {
    return `App agent '${name}' already exists`;
}

/**
 * The parts of a manifest {@link collectSchemaContent} walks. Manifests nest
 * sub-manifests of the same shape, and only the inline schema content matters
 * here, so this is narrower than `AppAgentManifest`.
 */
type SchemaBearingManifest = {
    schema?:
        | string
        | { schemaFile?: string | { format: string; content: string } };
    subActionManifests?: Record<string, SchemaBearingManifest>;
};

/**
 * Schema sources a manifest carries, in a deterministic order. Only inline
 * content counts: a file path would not be comparable across machines.
 */
function collectSchemaContent(
    manifest: AppAgentManifest | SchemaBearingManifest,
    out: string[],
): void {
    const { schema, subActionManifests } = manifest as SchemaBearingManifest;
    const schemaFile =
        typeof schema === "string" ? undefined : schema?.schemaFile;
    if (schemaFile !== undefined && typeof schemaFile !== "string") {
        out.push(`${schemaFile.format}\u0000${schemaFile.content}`);
    }
    if (subActionManifests !== undefined) {
        for (const key of Object.keys(subActionManifests).sort()) {
            out.push(`sub\u0000${key}`);
            collectSchemaContent(subActionManifests[key], out);
        }
    }
}

/** Stable JSON with recursively sorted keys, used only as a last-resort key. */
function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
            (key) =>
                `${JSON.stringify(key)}:${canonicalize(
                    (value as Record<string, unknown>)[key],
                )}`,
        );
    return `{${entries.join(",")}}`;
}

/**
 * Version key two clients must agree on to share a group.
 *
 * Hashes the schema *text*, not the manifest: Android builds its manifest with
 * `org.json.JSONObject`, whose key order is not stable, so hashing the object
 * would make two phones running the same APK look like a version mismatch. A
 * manifest with no inline schema falls back to a key-sorted form.
 */
export function getManifestKey(manifest: AppAgentManifest): string {
    const parts: string[] = [];
    collectSchemaContent(manifest, parts);
    const source =
        parts.length > 0 ? parts.join("\u0001") : canonicalize(manifest);
    return createHash("sha256").update(source).digest("hex");
}

export function schemaMismatchMessage(name: string): string {
    return `Client agent '${name}' is already registered on this conversation with a different schema version. Update the app to the same version as the other device(s), or disconnect them first.`;
}

/**
 * Names the user can tell apart. Two phones of the same model both report
 * "Pixel 8", so duplicates get a numeric suffix in registration order.
 */
export function getInstanceLabels(group: ClientAgentGroup): string[] {
    const instances = [...group.instances.values()].sort(
        (a, b) => a.registeredAt - b.registeredAt,
    );
    const counts = new Map<string, number>();
    for (const instance of instances) {
        counts.set(
            instance.displayName,
            (counts.get(instance.displayName) ?? 0) + 1,
        );
    }
    const seen = new Map<string, number>();
    return instances.map((instance) => {
        if ((counts.get(instance.displayName) ?? 0) <= 1) {
            return instance.displayName;
        }
        const n = (seen.get(instance.displayName) ?? 0) + 1;
        seen.set(instance.displayName, n);
        return `${instance.displayName} (${n})`;
    });
}

export function ambiguousDeviceMessage(group: ClientAgentGroup): string {
    return `'${group.name}' is hosted by ${group.instances.size} devices (${getInstanceLabels(
        group,
    ).join(", ")}). Run the request from the device you want it to act on.`;
}

/**
 * Pick the device a call goes to. We never guess: an action on the wrong
 * phone is worse than one that does not run, because the user believes it ran.
 * So there are two certain ways to route, and a failure when neither applies.
 *
 * Read-only calls (`sideEffecting` false) change nothing on the device and
 * every instance runs the same build, so they take any instance rather than
 * failing a question the user never asked.
 */
function selectInstance(
    group: ClientAgentGroup,
    sessionContext: SessionContext<unknown> | undefined,
    sideEffecting: boolean,
): ClientAgentInstance {
    if (group.instances.size === 0) {
        throw new Error(`No device is connected for '${group.name}'`);
    }

    // The device that made the request. Certain, and the common case.
    const connectionId = sessionContext?.currentConnectionId;
    if (connectionId !== undefined) {
        for (const instance of group.instances.values()) {
            if (instance.connectionId === connectionId) {
                debugRoute(
                    `${group.name}: requester -> ${instance.instanceId} (${instance.displayName})`,
                );
                return touch(instance);
            }
        }
    }

    // The only candidate, so there is nothing to get wrong. This is what keeps
    // "ask the shell, act on my one phone" working.
    if (group.instances.size === 1) {
        const only = group.instances.values().next().value!;
        debugRoute(
            `${group.name}: single -> ${only.instanceId} (${only.displayName})`,
        );
        return touch(only);
    }

    if (sideEffecting) {
        debugRoute(`${group.name}: ambiguous, refusing to pick`);
        throw new Error(ambiguousDeviceMessage(group));
    }
    const any = group.instances.values().next().value!;
    debugRoute(`${group.name}: read-only -> ${any.instanceId}`);
    return touch(any);
}

function touch(instance: ClientAgentInstance): ClientAgentInstance {
    instance.lastUsed = Date.now();
    return instance;
}

// Every AppAgent method that carries a SessionContext, and where in the
// argument list it sits. Used both to route the call and to hand the instance
// its own agent context.
const sessionContextArg: Record<string, number> = {
    updateAgentContext: 1,
    closeAgentContext: 0,
    checkReadiness: 0,
    startBackgroundTasks: 0,
    stopBackgroundTasks: 0,
    validateWildcardMatch: 1,
    resolveEntity: 2,
    getTemplateSchema: 2,
    getTemplateCompletion: 3,
    getActionCompletion: 0,
    getDynamicDisplay: 2,
    getDynamicSchema: 0,
    getDynamicGrammar: 0,
    getCommands: 0,
    getCommandCompletion: 3,
};

// Same, for methods that carry an ActionContext instead.
const actionContextArg: Record<string, number> = {
    streamPartialAction: 4,
    executeAction: 1,
    handleChoice: 2,
    setup: 0,
    executeCommand: 2,
};

// Lifecycle methods that must reach every instance, not just the routed one.
// initializeAgentContext is absent because it takes no context, so the mux
// cannot tell instances apart; late joiners go through initializeInstance.
const broadcastMethods = new Set([
    "updateAgentContext",
    "closeAgentContext",
    "startBackgroundTasks",
    "stopBackgroundTasks",
]);

// Calls that change something on the device. These refuse to run rather than
// pick a device; everything else is read-only and takes any instance.
const sideEffectingMethods = new Set([
    "executeAction",
    "executeCommand",
    "handleChoice",
    "setup",
]);

/**
 * Per-instance view of a context.
 *
 * The dispatcher holds one `SessionContext` whose `agentContext` came from the
 * first instance. Handing that to a second instance's rpc proxy would send it
 * an id minted by another process, so each instance sees the context with its
 * own `agentContext` spliced in. Views are cached because agent-rpc keys its
 * context table on object identity, so a fresh wrapper per call would leak.
 */
type InstanceContexts = {
    agentContext: unknown;
    agentContextSet: boolean;
    sessionViews: WeakMap<object, SessionContext<unknown>>;
    actionViews: WeakMap<object, ActionContext<unknown>>;
};

function viewSessionContext(
    contexts: InstanceContexts,
    context: SessionContext<unknown>,
): SessionContext<unknown> {
    if (!contexts.agentContextSet) {
        return context;
    }
    const cached = contexts.sessionViews.get(context);
    if (cached !== undefined) {
        return cached;
    }
    const view = Object.create(context, {
        agentContext: {
            value: contexts.agentContext,
            enumerable: true,
        },
    }) as SessionContext<unknown>;
    contexts.sessionViews.set(context, view);
    return view;
}

function viewActionContext(
    contexts: InstanceContexts,
    context: ActionContext<unknown>,
): ActionContext<unknown> {
    if (!contexts.agentContextSet) {
        return context;
    }
    const cached = contexts.actionViews.get(context);
    if (cached !== undefined) {
        return cached;
    }
    const view = Object.create(context, {
        sessionContext: {
            value: viewSessionContext(contexts, context.sessionContext),
            enumerable: true,
        },
    }) as ActionContext<unknown>;
    contexts.actionViews.set(context, view);
    return view;
}

type GroupInternals = {
    contexts: Map<string, InstanceContexts>;
    // The SessionContext the dispatcher handed the group, remembered so a
    // late-joining instance can be initialized and enabled the same way the
    // first one was.
    sessionContext: SessionContext<unknown> | undefined;
    enabledSchemas: Set<string>;
};

const internals = new WeakMap<ClientAgentGroup, GroupInternals>();

function getInternals(group: ClientAgentGroup): GroupInternals {
    const state = internals.get(group);
    if (state === undefined) {
        throw new Error(
            "Internal error: client agent group is not initialized",
        );
    }
    return state;
}

function getContexts(
    group: ClientAgentGroup,
    instanceId: string,
): InstanceContexts {
    const state = getInternals(group);
    let contexts = state.contexts.get(instanceId);
    if (contexts === undefined) {
        contexts = {
            agentContext: undefined,
            agentContextSet: false,
            sessionViews: new WeakMap(),
            actionViews: new WeakMap(),
        };
        state.contexts.set(instanceId, contexts);
    }
    return contexts;
}

/**
 * The mux dispatches by method name, which the `AppAgent` interface gives no
 * indexed access to. Every method on it is async and the mux only ever passes
 * the arguments back through, so this is all it needs to know about them.
 */
type AppAgentMethod = (...args: unknown[]) => unknown;

/** Indexed view of an agent, for the name-keyed dispatch below. */
function methodsOf(
    appAgent: AppAgent,
): Record<string, AppAgentMethod | undefined> {
    return appAgent as unknown as Record<string, AppAgentMethod | undefined>;
}

function createMux(group: ClientAgentGroup, template: AppAgent): AppAgent {
    const mux: Record<string, AppAgentMethod> = {};
    for (const method of Object.keys(template)) {
        if (methodsOf(template)[method] === undefined) {
            continue;
        }
        if (method === "initializeAgentContext") {
            mux[method] = async (...args: unknown[]) => {
                const first = group.instances.values().next().value;
                if (first === undefined) {
                    return undefined;
                }
                const agentContext = await methodsOf(
                    first.appAgent,
                ).initializeAgentContext?.(...args);
                const contexts = getContexts(group, first.instanceId);
                contexts.agentContext = agentContext;
                contexts.agentContextSet = true;
                return agentContext;
            };
            continue;
        }

        const sessionArg = sessionContextArg[method];
        const actionArg = actionContextArg[method];
        const broadcast = broadcastMethods.has(method);
        const sideEffecting = sideEffectingMethods.has(method);

        mux[method] = async (...args: unknown[]) => {
            const rebind = (instance: ClientAgentInstance) => {
                const contexts = getContexts(group, instance.instanceId);
                const bound = [...args];
                if (sessionArg !== undefined && bound[sessionArg]) {
                    bound[sessionArg] = viewSessionContext(
                        contexts,
                        bound[sessionArg] as SessionContext<unknown>,
                    );
                } else if (actionArg !== undefined && bound[actionArg]) {
                    bound[actionArg] = viewActionContext(
                        contexts,
                        bound[actionArg] as ActionContext<unknown>,
                    );
                }
                return bound;
            };

            if (broadcast) {
                const state = getInternals(group);
                if (method === "updateAgentContext") {
                    // Remember how the dispatcher enabled the group so a
                    // device that joins later can be brought to the same state.
                    const [enable, sessionContext, schemaName] = args as [
                        boolean,
                        SessionContext<unknown>,
                        string,
                    ];
                    state.sessionContext = sessionContext;
                    if (enable) {
                        state.enabledSchemas.add(schemaName);
                    } else {
                        state.enabledSchemas.delete(schemaName);
                    }
                } else if (method === "startBackgroundTasks") {
                    state.sessionContext = args[0] as SessionContext<unknown>;
                }
                const results = await Promise.all(
                    [...group.instances.values()].map((instance) =>
                        methodsOf(instance.appAgent)[method]?.(
                            ...rebind(instance),
                        ),
                    ),
                );
                if (method === "closeAgentContext") {
                    state.sessionContext = undefined;
                    state.enabledSchemas.clear();
                }
                return results[0];
            }

            const context =
                actionArg !== undefined
                    ? (args[actionArg] as ActionContext<unknown> | undefined)
                          ?.sessionContext
                    : sessionArg !== undefined
                      ? (args[sessionArg] as SessionContext<unknown>)
                      : undefined;
            const instance = selectInstance(group, context, sideEffecting);
            const fn = methodsOf(instance.appAgent)[method];
            if (fn === undefined) {
                throw new Error(
                    `Client agent '${group.name}': device '${instance.displayName}' does not support '${method}'`,
                );
            }
            return fn.apply(instance.appAgent, rebind(instance));
        };
    }
    return mux as unknown as AppAgent;
}

/**
 * Bring a device that joined late up to the state the others are in. Failures
 * are traced, not thrown: one device must not fail another's registration.
 */
async function initializeInstance(
    group: ClientAgentGroup,
    instance: ClientAgentInstance,
): Promise<void> {
    const state = getInternals(group);
    const contexts = getContexts(group, instance.instanceId);
    const appAgent = methodsOf(instance.appAgent);
    try {
        if (appAgent.initializeAgentContext !== undefined) {
            contexts.agentContext = await appAgent.initializeAgentContext();
            contexts.agentContextSet = true;
        }
        const sessionContext = state.sessionContext;
        if (sessionContext !== undefined) {
            const view = viewSessionContext(contexts, sessionContext);
            await appAgent.startBackgroundTasks?.(view);
            for (const schemaName of state.enabledSchemas) {
                await appAgent.updateAgentContext?.(true, view, schemaName);
            }
        }
    } catch (e) {
        debugGroup(
            `${group.name}: failed to initialize late-joining instance ${instance.instanceId}: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
}

export function createClientAgentGroup(
    name: string,
    registration: ClientAgentRegistration,
): ClientAgentGroup {
    const instance: ClientAgentInstance = {
        instanceId: registration.instanceId,
        displayName: registration.displayName,
        connectionId: registration.connectionId,
        appAgent: registration.appAgent,
        registeredAt: Date.now(),
        lastUsed: Date.now(),
    };
    const group: ClientAgentGroup = {
        name,
        manifest: registration.manifest,
        manifestKey: getManifestKey(registration.manifest),
        multiInstance: registration.multiInstance === true,
        instances: new Map([[instance.instanceId, instance]]),
        mux: undefined as unknown as AppAgent,
    };
    internals.set(group, {
        contexts: new Map(),
        sessionContext: undefined,
        enabledSchemas: new Set(),
    });
    group.mux = createMux(group, registration.appAgent);
    debugGroup(
        `${name}: created group, instance ${instance.instanceId} (${instance.displayName}) on connection ${instance.connectionId}`,
    );
    return group;
}

/**
 * Add a device, or replace its proxy if the same `instanceId` is already
 * there. Replacing in place is what makes a reconnect work: the device keeps
 * its slot and the dispatcher never sees a change. Returns true if the group
 * gained an instance.
 */
export async function joinClientAgentGroup(
    group: ClientAgentGroup,
    registration: ClientAgentRegistration,
): Promise<boolean> {
    const manifestKey = getManifestKey(registration.manifest);
    if (manifestKey !== group.manifestKey) {
        throw new Error(schemaMismatchMessage(group.name));
    }

    const existing = group.instances.get(registration.instanceId);
    if (existing !== undefined) {
        existing.appAgent = registration.appAgent;
        existing.connectionId = registration.connectionId;
        existing.displayName = registration.displayName;
        existing.lastUsed = Date.now();
        debugGroup(
            `${group.name}: replaced instance ${existing.instanceId} (${existing.displayName}) on connection ${existing.connectionId}, instances: ${group.instances.size}`,
        );
        return false;
    }

    // A connection hosts one instance per agent name: both would sit on the
    // single agent:<name> channel, so an instance already on this connection
    // is the same client coming back under a new id, and its proxy died when
    // the new registration claimed that channel. Retire it and hand its slot
    // over. Leaving it would strand it past the connection's disconnect, and
    // requester routing scans in insertion order, so it would be picked ahead
    // of the live one. This is a replacement rather than a second device, so
    // it does not need the sharing opt-in below.
    const superseded = findInstanceIdForConnection(
        group,
        registration.connectionId,
    );
    if (superseded !== undefined) {
        group.instances.delete(superseded);
        getInternals(group).contexts.delete(superseded);
        debugGroup(
            `${group.name}: retired instance ${superseded}; connection ${registration.connectionId} re-registered as ${registration.instanceId}`,
        );
    } else if (!group.multiInstance) {
        // Sharing is opt-in, and the group's creator decides. A client that
        // opts in cannot join a group whose creator did not, so no client can
        // widen another client's agent.
        debugGroup(
            `${group.name}: rejected instance ${registration.instanceId}; the registration did not opt in to sharing`,
        );
        throw new Error(agentAlreadyExistsMessage(group.name));
    }

    const instance: ClientAgentInstance = {
        instanceId: registration.instanceId,
        displayName: registration.displayName,
        connectionId: registration.connectionId,
        appAgent: registration.appAgent,
        registeredAt: Date.now(),
        lastUsed: Date.now(),
    };
    group.instances.set(instance.instanceId, instance);
    debugGroup(
        `${group.name}: added instance ${instance.instanceId} (${instance.displayName}) on connection ${instance.connectionId}, instances: ${group.instances.size}`,
    );
    await initializeInstance(group, instance);
    return superseded === undefined;
}

/** The instance this connection owns in the group, if any. */
export function findInstanceIdForConnection(
    group: ClientAgentGroup,
    connectionId: string,
): string | undefined {
    for (const instance of group.instances.values()) {
        if (instance.connectionId === connectionId) {
            return instance.instanceId;
        }
    }
    return undefined;
}

export type RemoveClientAgentInstanceOptions = {
    /**
     * Only remove the instance if it still names this connection. A sleeping
     * phone leaves a half-open socket, then reconnects on a new one; without
     * this check the late disconnect would evict the live device.
     */
    ownerConnectionId?: string | undefined;
};

/** Returns true if the instance was removed. */
export function removeClientAgentInstance(
    group: ClientAgentGroup,
    instanceId: string,
    options?: RemoveClientAgentInstanceOptions,
): boolean {
    const instance = group.instances.get(instanceId);
    if (instance === undefined) {
        return false;
    }
    const owner = options?.ownerConnectionId;
    if (owner !== undefined && instance.connectionId !== owner) {
        debugGroup(
            `${group.name}: kept instance ${instanceId}; it now belongs to connection ${instance.connectionId}, not ${owner}`,
        );
        return false;
    }
    group.instances.delete(instanceId);
    getInternals(group).contexts.delete(instanceId);
    debugGroup(
        `${group.name}: removed instance ${instanceId} (${instance.displayName}), instances: ${group.instances.size}`,
    );
    return true;
}

/**
 * What the registry needs from the conversation's dispatcher. A parameter
 * rather than a dependency, so the registry can be tested without one.
 */
export type ClientAgentHost = {
    addDynamicAgent(
        name: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
    ): Promise<void>;
    removeDynamicAgent(name: string): Promise<void>;
};

/**
 * The client-hosted agents of one conversation.
 *
 * Every mutation runs under this registry's own lock. Joining is a
 * read-modify-write, and the dispatcher's command lock only wraps the
 * addDynamicAgent call, not the lookup that decides to make it: without this,
 * two devices registering at once would both create a group and the second
 * would throw "already exists". The dispatcher's lock is always taken inside
 * this one, never the reverse.
 */
export type ClientAgentRegistry = {
    readonly groups: ReadonlyMap<string, ClientAgentGroup>;
    add(
        host: ClientAgentHost,
        name: string,
        registration: ClientAgentRegistration,
    ): Promise<void>;
    remove(
        host: ClientAgentHost | undefined,
        name: string,
        instanceId: string,
        options?: RemoveClientAgentInstanceOptions,
    ): Promise<boolean>;
    findInstanceIdForConnection(
        name: string,
        connectionId: string,
    ): string | undefined;
};

export function createClientAgentRegistry(): ClientAgentRegistry {
    const groups = new Map<string, ClientAgentGroup>();
    const lock = createLimiter(1);
    return {
        groups,
        add(host, name, registration) {
            return lock(async () => {
                const existing = groups.get(name);
                if (existing !== undefined) {
                    await joinClientAgentGroup(existing, registration);
                    return;
                }
                const group = createClientAgentGroup(name, registration);
                await host.addDynamicAgent(
                    name,
                    registration.manifest,
                    group.mux,
                );
                groups.set(name, group);
            });
        },
        remove(host, name, instanceId, options) {
            return lock(async () => {
                const group = groups.get(name);
                if (group === undefined) {
                    return false;
                }
                if (!removeClientAgentInstance(group, instanceId, options)) {
                    return false;
                }
                if (group.instances.size > 0) {
                    return true;
                }
                groups.delete(name);
                if (host !== undefined) {
                    await host.removeDynamicAgent(name);
                    debugGroup(
                        `${name}: removed the dynamic agent; last instance left`,
                    );
                }
                return true;
            });
        },
        findInstanceIdForConnection(name, connectionId) {
            const group = groups.get(name);
            return group === undefined
                ? undefined
                : findInstanceIdForConnection(group, connectionId);
        },
    };
}
