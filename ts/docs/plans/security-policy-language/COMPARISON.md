# Recommendation: Use OPA/Rego for AI Tool Policy

Status: executive recommendation
Date: 2026-08-10

## Recommendation

A policy writer states a security policy in natural language. An AI translates it
into a formal intermediary, and a deterministic compiler turns that intermediary
into an enforcement mechanism. Before deployment, the policy writer must be able to
inspect a deterministic natural-language rendering of the formal policy and decide
whether the translation is faithful.

**Use OPA/Rego as the intermediary language and retain it as the plan of record.**
Deploy OPA as a service, sidecar, or precompiled bundle and add an enterprise
explainability profile: typed inputs, a total decision envelope, controlled built-ins,
stable rule identifiers, deterministic review artifacts, and decision provenance.

We evaluated three architectures:

1. a **closed, TypeScript-defined policy schema**, represented as structured data; or
2. a **general relational policy language**, represented here by Rego; or
3. a **catalog of closed policy-schema packages**, implemented in either TypeScript
   or Rego.

The closed TypeScript schema should remain a control implementation and challenger,
not become a second production policy platform. It should replace Rego only if it
clears the large-margin replacement gates in this document after migration and
ecosystem costs are included.

## Why OPA/Rego

OPA/Rego is the strongest product choice for five reasons:

1. **It covers the expected policy frontier.** AI tool policy will need joins,
   quantification, derived facts, reusable enterprise abstractions, and relationships
   that were not anticipated when the first schema shipped.
2. **Its logic is declarative and inspectable.** A Datalog-like enterprise profile can
   expose rule dependencies, derivations, and order-independent logical meaning.
3. **It is production-mature.** OPA is a CNCF Graduated platform with established
   service, sidecar, bundle, discovery, and operational patterns.
4. **It can become more closed where closure helps.** Stable domains can be published
   as versioned closed Rego packages with finite policy data, paired semantic leaf
   registries, and total renderers, without introducing another evaluator platform.
5. **It is already the plan of record.** Replacing it incurs migration, retraining,
   duplicated tooling, governance, and lost ecosystem option value. A challenger must
   deliver a large user-visible assurance gain, not merely a cleaner implementation.

The closed schema has one genuine advantage: inside a fixed vocabulary, it can
guarantee a shorter and more canonical domain rendering by construction. That
advantage does not outweigh Rego's expressive headroom and implementation maturity on
the evidence available today. We should capture the advantage through closed Rego
packages and a deterministic review contract, while validating the residual gap with
the TypeScript challenger.

## What “round trip” means

The forward translation may use AI:

```text
natural-language policy -> formal policy
```

The reverse translation must not:

```text
formal policy -> deterministic review artifact
```

The review artifact may contain prose, decision tables, exception tables, and rule
graphs. It must be:

- **Complete:** every decision-affecting default, condition, exception, precedence
  rule, dependency, and failure behavior is represented.
- **Concise:** common conditions are factored and policy concepts are named once,
  without omitting information.
- **Deterministic:** the same normalized formal policy and renderer version produce
  the same artifact.
- **Canonical:** irrelevant formatting, ordering, and local names do not alter the
  artifact.
- **Traceable:** every sentence and table row maps to formal policy nodes.

Completeness is mandatory. Concision is optimized subject to completeness.

## Definition of a closed policy schema

Treat the authored policy as a semantic tree. Its internal nodes compose policy
constructs; its leaves are the atomic conditions, effects, defaults, obligations,
and other elements that can affect a decision. Syntax-only parser leaves such as
identifiers and literals do not satisfy this definition by themselves.

A policy schema is **closed** only when every permitted semantic leaf is selected
from a finite, versioned registry and has both:

1. an unambiguous natural-language description of its policy meaning; and
2. an executable predicate whose result does not depend on LLM interpretation.

For a condition, the predicate classifies an input. For an effect, obligation, or
configuration setting, it can relate inputs to decisions or pre-state to post-state.
It must still return a deterministic, testable result.

The schema must reject a policy if any semantic leaf lacks either representation.
Composition, precedence, missing-data behavior, and error behavior must likewise have
deterministic semantics and deterministic descriptions. Parameters may supply values
such as paths, limits, identities, and times, but may not introduce arbitrary code,
free-form conditions, or prose that an LLM must interpret at evaluation time.

This is a semantic requirement, not a serialization requirement. JSON, TypeScript,
Rego, or another notation can describe a closed schema if its authorable policy
surface obeys this leaf contract. Conversely, a finite JSON envelope containing an
opaque expression, callback, script, URI, or vendor payload is not closed merely
because the envelope validates.

## Schema types and how to close them

The following are recurring schema shapes, not competing serialization formats. The
Intune model is a useful guide because it combines a typed Graph envelope, a Settings
Catalog, templates, assignment filters, targets, and custom payload escape hatches.
For each shape, closure requires more than validating the outer JSON.

| Schema type                | Intune-style example                             | What remains open                                                                          | What closes it                                                                                                    |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Finite choice              | Enable or disable a catalog setting              | A Boolean or enum does not state what the choice does                                      | Register every choice with a complete description and deterministic predicate                                     |
| Constrained scalar         | Password length, timeout, or port                | The primitive type omits units, bounds, comparison meaning, and unsupported values         | Pin the parameter schema and predicate, including units, ranges, and boundary behavior                            |
| Group or template          | Endpoint-security profile                        | A template ID and object shape do not close descendant settings, defaults, or dependencies | Version the template and close every reachable leaf and composition rule                                          |
| Repeated collection        | Firewall rules or account payloads               | An array permits unknown element meanings, duplicate behavior, or unbounded cardinality    | Close the element union, identity rule, cardinality, ordering, and conflict semantics                             |
| Target or assignment       | Include a group and exclude filtered devices     | Group identity alone does not define membership data, evaluation time, or precedence       | Define the target predicates, external-data contract, snapshot semantics, and include/exclude rules               |
| Boolean expression         | Intune assignment-filter rule text               | A string can hide arbitrary properties, operators, parsing, and null behavior              | Use a versioned AST with closed property and operator registries and total composition semantics                  |
| Protocol-addressed setting | Custom Windows OMA-URI                           | A typed value beside an arbitrary URI leaves device semantics open                         | Register the exact URI, value schema, applicability, description, and device-state predicate                      |
| Imported payload or script | ADMX, plist, mobileconfig, or remediation script | A valid wrapper or file hash says nothing about policy meaning                             | Admit only registered, versioned payload packages with validators and predicates; otherwise classify them as open |

### Finite choice and constrained scalar leaves

Consider an illustrative catalog entry represented as:

```json
{
  "settingDefinitionId": "windows.firewall.enabled",
  "value": true
}
```

The field types close the wire shape but not the policy semantics. A closed registry
entry must bind the identifier and parameter schema to both required representations:

```typescript
{
    id: "windows.firewall.enabled",
    version: 1,
    parameters: { value: "boolean" },
    describe: ({ value }) =>
        value
            ? "Windows Firewall must be enabled."
        : "Windows Firewall must be disabled.",
    predicate: ({ value }, device) => device.firewall.enabled === value,
}
```

The description must state the actual modality: “must be enabled” is different from
“the service receives `true`.” The predicate must test the policy meaning, not merely
that a payload was accepted for delivery.

A scalar setting adds parameters such as unit, range, and comparison direction. For
example, “minimum password length is 14 characters” may mean
`device.minimumPasswordLength >= 14`, whereas an exact desired-state setting may mean
equality. The registry must choose one meaning, render it unambiguously, reject values
outside its declared range, and test the boundary. A generic `number` leaf is not
closed.

### Groups, templates, and collections

An Intune-style template can constrain a profile to a known family, such as endpoint
security antivirus. The template is an internal tree node, not proof that its leaves
are closed. Its version must determine:

- the exact set of permitted child definition IDs;
- which children are required, optional, or repeated;
- defaults and whether omitted children have policy meaning;
- dependencies and mutually exclusive choices;
- collection identity, cardinality, ordering, and duplicate handling; and
- conflict and precedence behavior within and across profiles.

Every reachable child still needs its own description and predicate. A template is
closed only when arbitrary settings or payloads cannot be inserted through a generic
child slot and every valid tree has total deterministic semantics.

### Targets and assignments

A target such as “devices in Finance, excluding personally owned devices” introduces
external data but can remain closed. Its leaves might be registered as:

```text
group.member("finance-device-group")
device.ownership.equals("corporate")
```

The first predicate requires a declared group-membership source; the second requires
a typed device property and fixed equality semantics. Closure also requires rules for
when membership is sampled, what happens when either source is missing or stale, and
whether exclusion overrides inclusion. Given the declared input snapshot, evaluation
and description must be deterministic. An LLM must not infer what a group name means.

### Boolean expressions and assignment filters

Storing an Intune assignment filter as an opaque string leaves the semantic tree
hidden inside the string. A closed representation uses a versioned expression AST:

```json
{
  "all": [
    {
      "predicate": "device.manufacturer.equals",
      "arguments": { "value": "Microsoft" }
    },
    {
      "predicate": "device.model.startsWith",
      "arguments": { "value": "Surface" }
    }
  ]
}
```

Each predicate ID must resolve to a registry entry containing its description,
argument schema, executable predicate, supported platforms, and missing/error
behavior. Operators such as `all`, `any`, and `not` also need fixed evaluation and
rendering rules. Allowing arbitrary property paths, operator names, functions, or raw
expression fragments reopens the schema.

### Protocol addresses, imported payloads, and scripts

Custom OMA-URI demonstrates the difference between a closed wrapper and a closed
policy leaf. Graph can validate that `omaUri` is a string and that an integer setting
contains an integer, while remaining unable to establish what the URI changes on a
device. To close one such leaf, its registry entry must pin:

- the exact URI and protocol version;
- the value type, legal values, and serialization;
- platform, edition, and version applicability;
- an unambiguous statement of the resulting device policy;
- an executable predicate over observable device state; and
- unsupported, delivery-failure, and conflicting-setting behavior.

The generic “custom URI” slot must remain classified as open. Individual URIs can
become closed leaves through governed registry additions.

The same rule applies to imported ADMX, plist, mobileconfig, and script content. A
hash can pin bytes but cannot supply their policy meaning. An imported artifact
becomes a closed package only when a versioned registration supplies a complete
validator, description, predicate, applicability contract, and conformance tests.
Arbitrary imports remain explicit extensions outside the closed schema.

### Minimum closure package

Across these schema types, each versioned package needs five coordinated artifacts:

1. **Structural schema:** valid tree shapes, node variants, parameter types, and
   constraints.
2. **Semantic leaf registry:** stable IDs pairing descriptions with executable
   predicates.
3. **Composition contract:** deterministic Boolean, precedence, default,
   missing-data, error, and conflict semantics.
4. **Applicability and dependency contract:** supported platforms, versions, external
   data, and observation points.
5. **Conformance suite:** positive, negative, boundary, missing-data, error, and
   description/predicate agreement tests for every leaf.

If any one is absent, the result may still be a useful typed policy catalog, but it
does not satisfy this document's definition of a closed policy schema.

## Claims-based authorization as a precedent

Claims and certificate systems solve a closely related problem. They transport facts
such as identity, clearance, group membership, entitlement, delegation, and validity
to a fast authorization check. Trust-management and relationship-based authorization
systems then combine those facts through logic such as:

> Permit reading a confidential document when the principal has confidential
> clearance **or** the document has been shared with that principal.

This has the same three desired projections:

1. **Human specification:** a dashboard or deterministic description that a policy
   owner can review.
2. **Executable decision:** a fast predicate over a principal, action, resource,
   context, and evidence snapshot.
3. **Closed semantic schema:** a versioned tree whose leaves project into both the
   human description and executable predicate.

The main lesson is that claims systems add a fourth concern: **why a fact should be
trusted**. A signed claim proves that an issuer made a statement. It does not, by
itself, establish that the statement is true, that the issuer is authoritative for
that predicate, or that the statement implies the requested authorization.

### Four planes, not one token

A reusable architecture separates four planes:

| Plane              | Question                                                                                                 | Example artifact                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Meaning and review | What does each policy leaf mean to a person?                                                             | Closed leaf registry and deterministic dashboard renderer                          |
| Evidence and trust | Which accepted facts follow from credentials, signatures, issuers, delegation, and current system state? | JWT validation, certificate-chain reduction, relationship tuples, and trust policy |
| Decision           | Do the accepted facts satisfy the authorization policy?                                                  | Closed AST evaluated by Rego, Cedar, Datalog, or a typed evaluator                 |
| Proof and audit    | Which evidence and rule applications produced this result?                                               | Typed derivation DAG with policy, evidence, and snapshot references                |

Token validation must finish before token claims become facts available to policy.
Policy evaluation must remain distinct from evidence validation. Proof output links
the two computations without conflating them.

### Worked confidential-document example

The closed policy tree can use registered predicates instead of embedding claim names
or storage queries directly:

```json
{
  "effect": "permit",
  "action": "document.read",
  "resourceType": "document",
  "when": {
    "any": [
      {
        "predicate": "principal.clearance.atLeast",
        "arguments": { "requiredLevelFrom": "resource.classification" }
      },
      {
        "predicate": "resource.sharedWithPrincipal",
        "arguments": {}
      }
    ]
  }
}
```

The first leaf compares an accepted clearance claim with the document's
classification. The second resolves a relationship fact scoped to the exact principal
and document. Registry entries provide the deterministic projections:

| Predicate ID                   | Human projection                                                                                         | Executable projection                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `principal.clearance.atLeast`  | “The principal's current clearance is at least the document classification.”                             | Compare levels using the registered classification order after accepting an in-scope clearance assertion from an authorized issuer |
| `resource.sharedWithPrincipal` | “The document is currently shared directly or through a registered sharing relation with the principal.” | Resolve the registered relation against the declared relationship snapshot                                                         |
| `any`                          | Join child descriptions with “either ... or ...”                                                         | Boolean disjunction with declared error and indeterminate behavior                                                                 |
| `document.read`                | “read the document”                                                                                      | Match the registered action and resource types                                                                                     |

The deterministic dashboard can render:

> Reading a document is permitted when either the principal's current clearance is
> at least the document classification or the document is shared with that principal.
> If neither branch succeeds and data needed to determine a branch is unavailable,
> the request is denied and the unavailable dependency is reported.

That sentence is generated from registry entries and composition rules. It is not an
LLM interpretation of the runtime policy.

### The decision proof is not the certificate chain

For a request allowed through clearance, the machine-generated proof can have this
shape:

```text
permit(document.read, alice, document-123)
└─ any [policy node p17]
  └─ principal.clearance.atLeast [leaf p18]
    ├─ acceptedClaim(alice, clearance, confidential)
    │  ├─ signatureValid(credential-789, issuer-key-4)
    │  ├─ trustedIssuerFor(issuer-key-4, principal.clearance)
    │  ├─ audienceMatches(document-service)
    │  ├─ validAt(credential-789, request-time)
    │  └─ notRevoked(credential-789, revocation-snapshot-22)
    ├─ resourceClassification(document-123, confidential)
    │  └─ resourceSnapshot(document-snapshot-91)
    └─ clearanceOrder(confidential, confidential)
```

For a request allowed through sharing, the successful branch instead cites the
relationship tuple and its consistency snapshot. The proof should retain stable IDs
for every policy node, registry entry, credential, issuer, relationship tuple,
external-data snapshot, and evaluator version.

This separates three different propositions:

1. **Credential validity:** the credential is well formed, in force, and signed by
   its stated issuer.
2. **Claim acceptance:** the verifier trusts that issuer to assert this predicate for
   this subject, audience, scope, and delegation path.
3. **Authorization derivation:** the accepted fact satisfies one branch of the active
   policy and no overriding denial applies.

A conventional X.509 chain commonly establishes a key or identity binding. A JWT
commonly transports signed claims. Neither chain is automatically a proof of the
third proposition. OAuth's JWT access-token profile explicitly leaves the resource
server's final use of authorization claims and context to the resource server.

### What existing systems contribute

| System or lineage                          | Reusable contribution                                                                                                                                               | What it does not supply by itself                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| JWT and OAuth access-token profiles        | Compact signed claim transport; issuer, subject, audience, time, token ID, scopes, roles, groups, and entitlements; standardized validation steps                   | A closed vocabulary for private claims, issuer authority for each predicate, canonical policy prose, or a final decision proof |
| X.509 and attribute certificates           | Mature signature, identity-chain, validity, and revocation machinery                                                                                                | Application authorization meaning and a proof that accepted identity implies access                                            |
| SPKI/SDSI                                  | Authorization bound directly to keys; local names; explicit delegation; validity and authorization intersection; tuple reduction; prover-supplied certificate paths | Complete application semantics for authorization tags or a modern dashboard contract                                           |
| SecPAL and related trust-management logics | The useful statement form “principal says claim if conditions”; constrained delegation; decentralized policy; Datalog-style derivations                             | A canonical business description for arbitrary predicate names                                                                 |
| Proof-carrying authorization               | Split proof search from proof checking so a requester can supply evidence that a small verifier checks                                                              | Human review and a closed ontology unless separately designed                                                                  |
| Biscuit                                    | Signed Datalog facts and rules, offline verification, scoped blocks, and monotonic attenuation in which token holders can add restrictions but not grants           | A closed domain vocabulary; its documentation notes that fact names have no intrinsic meaning                                  |
| Zanzibar-style relationship authorization  | Compact relationship tuples, graph reachability, high-throughput checks, and consistency tokens tying decisions to a data snapshot                                  | Attribute-claim trust chains, canonical natural-language policy, or a standardized decision-proof artifact                     |
| Cedar                                      | Typed principal-action-resource-context model, schema validation, analyzable expressions, explicit permit/forbid composition, implicit deny, and forbid override    | Leaf-level natural-language definitions and a portable proof DAG as required here                                              |
| Datalog-like Rego profile                  | Joins, OR branches, derived predicates, order-independent rule meaning under a restricted profile, and natural derivation provenance                                | Cryptographic claim transport, issuer trust, revocation, or canonical domain meaning                                           |

The systems are complementary. Claims and certificates authenticate evidence;
Zanzibar-like tuples supply resource relationships; Cedar or a closed Rego package
evaluates policy; Datalog provenance supplies the skeleton of a decision proof; and
the semantic leaf registry supplies stable human meaning.

### What to reuse

#### Use a typed claim registry, not arbitrary token fields

Extend the semantic leaf registry with an evidence contract for predicates that can
consume claims:

```typescript
interface ClaimPredicateDefinition<Arguments, ClaimValue, Input> {
  id: string;
  version: number;
  claimType: string;
  argumentsSchema: unknown;
  claimValueSchema: unknown;
  describe(arguments: Arguments): string;
  evaluate(arguments: Arguments, claim: ClaimValue, input: Input): boolean;
  trustedIssuers: IssuerAuthorityRule[];
  delegation: DelegationRule;
  validity: ValidityRule;
  missing: "false" | "indeterminate";
}
```

This is stronger than the JWT claims registry. The IANA registry records a claim name,
brief description, change controller, and specification reference. Our registry must
also supply value schema, executable meaning, issuer authority, audience and scope,
delegation, validity, missing/error behavior, and conformance tests.

Private JWT claims may still be transported, but they cannot enter a closed package
until mapped to a registered predicate version. Unknown claims must be ignored as
evidence or rejected according to the package contract, never interpreted by an LLM.

#### Reuse trust-chain reduction as fact normalization

SPKI's tuple-reduction pattern is directly useful. Normalize each accepted credential
to a small internal assertion containing:

```text
issuer, subject, predicate ID, arguments, delegation, audience,
validity interval, revocation snapshot, evidence reference
```

As authorization travels down a delegation chain, intersect rather than broaden its
scope, audience, validity, and delegability. The verifier controls the trust roots and
the rules describing which issuers may speak for which predicate namespaces. A chain
cannot manufacture authority that its root did not possess.

#### Reuse monotonic attenuation for delegated AI authority

Biscuit's most valuable property for AI-tool authorization is monotonic attenuation:
an intermediary can add checks that narrow a token but cannot add a new grant. This is
a strong model for delegated agent sessions. A user or service can issue a capability
for a tool, resource subset, purpose, and time window; downstream agents may reduce
those rights without contacting the issuer.

Attenuation does not replace central policy. The resource-side authorizer must still
apply current deny rules, incident controls, resource relationships, and data
classification policy.

#### Reuse relationship tuples and consistency snapshots

“The document has been shared with this person” is better modeled as a relationship
fact than copied into a long-lived identity token. Use a Zanzibar-style tuple or an
equivalent resource authorization store:

```text
document:123#viewer@user:alice
```

The authorization input must identify the relationship-store snapshot or consistency
token used for the check. This turns “shared now” into a reproducible fact and prevents
the audit trail from silently mixing policy and relationship versions.

#### Emit a typed proof DAG for every decision

The evaluator should return more than `allow: boolean`:

```typescript
interface AuthorizationResult {
  decision: "allow" | "deny" | "indeterminate";
  policyVersion: string;
  registryVersion: string;
  inputSnapshot: string;
  proofRoot: string;
  proofNodes: ProofNode[];
}
```

Proof-node variants should include accepted fact, rejected fact, signature validation,
issuer authority, delegation, validity, relationship lookup, rule application,
Boolean composition, override, missing dependency, and final decision. The runtime can
produce this structure while evaluating, avoiding a second explanatory evaluation
that might diverge from enforcement.

This runtime DAG is **derivation provenance**. It becomes a proof-carrying artifact
only if it is serialized with hashes or versions for the policy, registry, trust
rules, evaluator semantics, and evidence snapshots, and a separate small checker can
replay every inference step. A signature on the decision authenticates the producer;
an independently checkable derivation also tests how the producer reached it.

For production latency, return or persist a compact minimal witness plus stable
references. Expand it asynchronously into the dashboard tree. Policy bundles,
credential metadata, registry entries, and external snapshots can be cached and
indexed independently.

### Denial proofs require closed-world boundaries

Allow decisions usually have finite positive witnesses: one clearance chain or one
sharing path is enough for the OR-policy. Denials are harder because “no sharing path
exists” is not proven by the absence of a claim in one token.

A defensible denial explanation must identify the authoritative domains searched:

- the complete credential set or credential-discovery boundary considered;
- the relationship-store snapshot queried;
- the trust roots and issuer-authority policy used;
- failed validity, revocation, audience, and delegation checks;
- every policy branch that failed; and
- any unavailable dependency that changed the result to deny or indeterminate.

The result is a proof relative to declared snapshots and authorities, not a universal
proof that no credential or relationship exists anywhere. This is the claims-based
counterpart of requiring explicit missing-data semantics in a closed schema.

### Recommended integration

Do not replace the policy intermediary with JWTs or certificate chains. Use them as
evidence inputs to the existing plan of record:

```text
credentials + relationship snapshots + request context
                 |
                 v
      validation, trust, and delegation reduction
                 |
                 v
         accepted typed policy facts
                 |
                 v
     closed policy tree -> Rego/OPA evaluation
         |                    |
         v                    v
 deterministic dashboard     typed proof DAG
```

The near-term reusable design is therefore:

1. Keep OPA/Rego for decision logic and relational composition.
2. Define closed Rego packages whose leaf IDs come from the semantic registry.
3. Add credential adapters that normalize JWT, certificate, and service assertions
   into accepted typed facts only after trust reduction.
4. Keep volatile sharing and ownership relationships in a snapshot-addressable
   relationship service rather than identity tokens.
5. Require the evaluator to emit a typed derivation DAG from the same execution that
   enforces the decision.
6. Generate the dashboard specification from the policy tree and registry, then link
   each runtime proof node back to the same human description.

This preserves one meaning across authoring, review, enforcement, and audit while
reusing mature claims transport, certificate verification, relationship indexing,
and logic evaluation.

Primary references for this comparison are [JWT (RFC 7519)](https://www.rfc-editor.org/rfc/rfc7519),
[JWT Profile for OAuth Access Tokens (RFC 9068)](https://www.rfc-editor.org/rfc/rfc9068),
[OAuth Token Introspection (RFC 7662)](https://www.rfc-editor.org/rfc/rfc7662),
[SPKI Certificate Theory (RFC 2693)](https://www.rfc-editor.org/rfc/rfc2693),
[Eclipse Biscuit](https://doc.biscuitsec.org/),
[Zanzibar](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/),
and the [Cedar policy-language guide](https://docs.cedarpolicy.com/).

## The structural difference

### Closed TypeScript-defined schema

“TypeScript” in this option means TypeScript defines a finite policy data model. A
policy is an instance of that model, normally serialized as JSON. It does not mean a
policy author may write arbitrary TypeScript code.

```typescript
interface Policy {
  default: "allow" | "deny";
  tools: ToolRule[];
  paths: PathRule[];
  network: NetworkRule[];
  limits: LimitRule[];
}
```

Each semantic leaf has a registered natural-language definition and deterministic
executable predicate. Each field and variant also has validation rules, precedence,
and a rendering template. The language rejects concepts that are not in the model or
whose leaf contract is incomplete.

Its round-trip proposition is:

> If a policy is valid, the renderer has a total, domain-specific explanation for
> every node in it.

### Rego

Rego defines rules over structured input and data. Policy concepts may be represented
as rules, helper rules, joins, comprehensions, quantifiers, negation, or combinations
of these constructs.

```rego
default allow := false

allow if {
    input.tool.name == "read_file"
    permitted_path(input.resource.path)
}
```

An ideal parser and renderer can account for every expression and dependency. The
language, however, does not assign a security-domain meaning to every possible rule.

Its round-trip proposition is:

> Every policy can receive a complete logical explanation, but a concise
> domain-specific explanation may depend on how the policy was factored and named.

### What Datalog contributes to the round trip

Rego is Datalog-related, but Rego as a whole is not pure Datalog. The useful comparison
is therefore with a restricted Datalog-like policy profile: facts and range-restricted
rules over a finite data model, with recursion and negation admitted only under defined
semantics.

Datalog is more declarative than arbitrary TypeScript implementation code in a precise
sense. A positive Datalog program states which relations follow from other relations;
it does not specify a sequence of assignments, branches, loops, or mutations. Its
meaning is the least fixed point of its rules. Rule order and evaluation strategy do
not change that meaning. Stratified negation can preserve a similarly defined meaning
by evaluating negation across ordered strata, although it adds explanatory complexity.

For example:

```prolog
can_send(User, Recipient) :-
    recipient_account(Recipient, Account),
    assigned_account(User, Account).

allow(User, Request) :-
    send_request(Request, Recipient),
    can_send(User, Recipient).
```

This structure improves several parts of the reverse path:

- **Dependency extraction:** predicate references directly form a rule graph.
- **Provenance:** an allowed decision can be accompanied by the facts and rule
  instances that derived it.
- **Order independence:** source ordering and execution strategy need not appear in
  the explanation.
- **Structural normalization:** variable renaming, literal ordering within a
  conjunction, and some equivalent rule forms can be canonicalized.
- **Finite analysis:** under a finite Datalog profile, the complete derived relation
  and relevant proof trees can be enumerated.

A deterministic logical rendering can therefore say:

> The request is allowed because recipient `R` belongs to account `A`, account `A` is
> assigned to user `U`, and those facts satisfy the two rules deriving `can_send` and
> then `allow`.

That is a real round-trip advantage over arbitrary imperative TypeScript predicates,
where control flow, mutation, helper calls, and intermediate state must first be
reconstructed into a logical account.

Datalog does not, by itself, solve canonical domain interpretation:

- `can_send` is an author-chosen name, not a meaning established by Datalog.
- One rule can be split through helper predicates or inlined without changing the
  derived decisions.
- Extensionally equivalent rule sets need not have the same syntax or the same most
  concise explanation.
- Negation, aggregation, external built-ins, and conflict-resolution conventions add
  semantics that a review artifact must state explicitly.
- A rule graph explains how predicates derive other predicates, but it does not decide
  which abstractions a policy writer considers natural.

The resulting hierarchy is:

1. **Closed schema:** strongest canonical domain rendering inside a fixed ontology.
2. **Closed Datalog-like package:** the same ontology guarantee, plus transparent
   relational derivations inside the package.
3. **Open Datalog-like policy:** stronger logical provenance and normalization than
   arbitrary code, but no unique domain-level summary.
4. **Arbitrary TypeScript policy code:** computationally expressive, but the weakest
   structural basis for deterministic reverse interpretation.

This hierarchy compares authorable policy surfaces. TypeScript may still implement a
closed schema's evaluator, and Datalog or Rego may still implement its relational
internals. Datalog improves interpretability when its rule structure remains visible
to the review system; it does not replace ontology closure when the requirement is a
complete and concise canonical policy description.

## Bounded formalisms that can improve the round trip

Non-Turing-completeness is useful but insufficient. It can guarantee that evaluation
terminates, but it does not guarantee one canonical business explanation. The
round-trip value of a bounded formalism depends on what additional structure it
preserves: a closed domain vocabulary, a normalized expression tree, a decision
table, a derivation graph, or an explicit state-transition graph.

The relevant candidate families are:

| Formalism                                                   | What is structurally bounded                                              | Round-trip contribution                                                                  | Principal limitation                                                                                        | Practical TypeScript path                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Closed tagged-union rule algebra                            | Finite node and field variants                                            | Total domain renderer, structural completeness, canonical normalization                  | New concepts require a schema release                                                                       | Implement directly with TypeScript types plus runtime validation                                      |
| Propositional logic, decision trees, and ordered rule lists | Finite Boolean expressions or branches                                    | Straightforward truth tables, path explanations, and normal forms                        | Poor fit for joins and derived relationships; ordered lists make precedence part of meaning                 | Small in-house AST, JSON Logic, or a restricted rules engine                                          |
| Decision tables and DMN/FEEL                                | Finite input/output tables with declared hit policy                       | Direct business review artifact; overlap and gap analysis                                | Tables become awkward for graph-shaped relations and reusable derivations                                   | DMN modeler such as `dmn-js`; embedded evaluation requires a separately selected engine               |
| Finite-state machines and statecharts                       | Finite states and transitions                                             | Canonical lifecycle and available-transition views                                       | Describes stateful protocols, not general authorization; arbitrary guards and actions reopen the language   | XState with a closed guard and action catalog                                                         |
| CEL                                                         | Mutation-free terminating expression language over typed data             | Stable expression AST, type checking, bounded conditions, and deterministic evaluation   | Expressions still lack canonical business vocabulary; no native multi-rule derivation model                 | `@marcbachmann/cel-js` or another conformance-tested CEL implementation                               |
| Cedar                                                       | Authorization-specific `permit` and `forbid` policies over typed entities | Fixed authorization shape, schemas, explicit deny precedence, and analyzable expressions | Less natural for tool policies that are not principal-action-resource authorization                         | Official `@cedar-policy/cedar-wasm` package                                                           |
| Positive or stratified Datalog                              | Least-fixed-point rules over a finite fact domain                         | Rule graph, order-independent meaning, proof provenance, and relational joins            | Equivalent rule factorizations need not yield one domain summary; negation and aggregation need profiles    | Prefer a mature external engine or Wasm service; TypeScript-native choices are comparatively immature |
| Rego                                                        | Finite rule evaluation; recursion and unbounded loops are rejected        | Relational rules, comprehensions, quantifiers, dependencies, and explanation traces      | Broad syntax and author factoring weaken canonical domain rendering                                         | Official `@open-policy-agent/opa-wasm` package                                                        |
| Description logics and SHACL-like constraint languages      | Decidable ontology fragments or finite graph constraints                  | Named concepts, subsumption, validation reports, and ontology-aware explanations         | Open-world and closed-world assumptions are easy to miscommunicate; awkward as a complete decision language | RDF/SHACL libraries or a separate reasoner, usually as a validation layer                             |

Two exclusions matter:

- SQL is often terminating in a deployed database, and relational algebra fragments
  are non-Turing-complete, but recursive common-table expressions, procedural
  extensions, engine-specific functions, null semantics, and query-plan concerns make
  “SQL” too broad to be one candidate. A deliberately closed relational profile is a
  candidate; arbitrary SQL is not.
- A rules library is not automatically a bounded formalism. If rules can call
  arbitrary JavaScript, fetch asynchronous facts, register unrestricted operators,
  or execute callbacks, the serialized rule shell does not close the semantic
  surface.

### Practical implementation candidates

For this policy system, the strongest control implementation is a small TypeScript
rule algebra rather than executable TypeScript predicates:

```typescript
type Condition =
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | {
      kind: "compare";
      field: FieldReference;
      operator: ComparisonOperator;
      value: PolicyValue;
    }
  | {
      kind: "every";
      collection: FieldReference;
      condition: Condition;
    }
  | {
      kind: "exists";
      collection: FieldReference;
      condition: Condition;
    };
```

This is a language implemented in TypeScript, not policy written as arbitrary
TypeScript. Its trusted implementation should contain five distinct functions:

1. a validator that rejects unknown variants, invalid field references, and type
   mismatches;
2. a normalizer that sorts commutative children, flattens nested conjunctions and
   disjunctions, removes identities, and assigns stable node identifiers;
3. a total evaluator with explicit missing, error, deny, and indeterminate behavior;
4. a total renderer that emits prose, tables, and source mappings for every node; and
5. a trace evaluator that records the facts and child results supporting each
   decision.

That implementation establishes the best achievable round-trip baseline. It also
provides a neutral normalized representation against which imported CEL, Cedar,
Rego, or DMN policies can be compared.

The practical shortlist is:

1. **Build the closed TypeScript rule algebra** when round-trip assurance is the
   primary product property. Keep field references and operators registered and
   finite; do not admit callback predicates.
2. **Embed CEL inside governed schema fields** when the closed algebra needs richer
   typed conditions without admitting general code. CEL improves safety and
   portability, but the surrounding schema must still supply domain names, defaults,
   precedence, and rendering conventions.
3. **Use Cedar through `@cedar-policy/cedar-wasm`** when policies naturally reduce to
   principal, action, resource, entities, and request context. Require schema
   validation before evaluation; Cedar validation is available but not inherently
   mandatory.
4. **Use Rego through an OPA service or compiled bundle** when unforeseen joins,
   quantification, and derived relations are first-class requirements. Add the
   explainability contract described below. Treat `@open-policy-agent/opa-wasm` as a
   separately qualified embedded deployment path; Wasm packaging changes
   integration, not round-trip semantics.
5. **Use DMN for policy subsets that policy writers already understand as decision
   tables.** Treat the table itself as the review artifact and compile it into the
   common decision contract.
6. **Use JSON Logic or `json-rules-engine` only as a rapid prototype or interchange
   baseline.** JSON Logic has a conveniently finite JSON AST, while
   `json-rules-engine` supplies a practical TypeScript-facing rule engine. Either must
   be wrapped in an allowlist that disables arbitrary operators, callbacks,
   asynchronous fact acquisition, and implicit error behavior.

XState is useful for approval workflows, incident lifecycles, and multi-step tool
protocols. It should complement rather than replace the policy condition language.
Its state graph is finite, but custom guards, actions, actors, and delays are ordinary
code unless the enterprise closes those catalogs.

A TypeScript-native Datalog implementation is not the leading practical choice for
the first experiment. The formalism is valuable, but the JavaScript ecosystem is less
consolidated and less policy-oriented than CEL, Cedar, or OPA. Datalog should remain a
semantic profile and provenance benchmark unless relational recursion becomes a
demonstrated requirement.

## Six-month implementation readiness

Implementation maturity changes which candidates can responsibly enter a product in
six months, but it does not change their formal round-trip properties. The relevant
question is not merely whether an evaluator exists. It is whether the evaluator,
integration path, deployment model, and product-owned assurance layer can all reach a
supportable state in that window.

The current TypeAgent code is a useful head start rather than a finished policy
engine. `OrgPolicy` already defines a finite model for tools, paths, commands,
networking, limits, and containers; it performs plan-time and runtime checks and
returns explicit violation codes. However, its loader validates only the version and
name before casting JSON to the TypeScript interface, and the package does not yet
have a dedicated policy conformance suite. Productization therefore requires runtime
schema validation, normalization, canonical rendering, source mapping, decision
traces, and systematic missing/error tests.

### Readiness matrix

| Candidate                 | Core implementation                                                                                                            | TypeScript integration                                                                                                                                             | Recommended deployment                                                                         | Product-owned work still required                                                                                                                 | Six-month disposition                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Closed TypeScript AST     | Existing TypeAgent prototype; evaluator surface is already present                                                             | Native and fully controllable                                                                                                                                      | In-process library behind a versioned decision API                                             | Runtime schema, normalizer, total renderer, traces, migration rules, conformance and mutation tests                                               | **Build as the challenger and closed-policy baseline**         |
| Cedar                     | Official, actively maintained authorization engine with schemas, validation, formatter, CLI, and analysis tooling              | Official `@cedar-policy/cedar-wasm`; current releases include TypeScript declarations and signed provenance                                                        | Embedded Wasm for principal-action-resource decisions                                          | Domain adapter, entity model, schema-validation gate, common traces and review rendering                                                          | **Ship for the authorization-shaped subset**                   |
| OPA/Rego                  | Production-mature, CNCF Graduated policy platform with established bundles, discovery, APIs, tooling, and operational patterns | Service and CLI integration are mature; `@open-policy-agent/opa-wasm` is usable but its README still says “Work in Progress” and its npm release cadence is weaker | OPA service, sidecar, or precompiled bundle; qualify Wasm separately if embedding is mandatory | Restricted profile, typed input contract, total decision envelope, artifact renderer, trace adapter, bundle governance                            | **Ship as the plan-of-record core**                            |
| CEL                       | Mature specification and implementations; mutation-free, terminating expressions with checked ASTs                             | `@marcbachmann/cel-js` is active and capable, but community-maintained and advertises support for “Most of the CEL Spec”                                           | In-process only behind a frozen adapter and allowlisted environment                            | Pin supported CEL profile, disable custom and asynchronous extensions, run upstream-style conformance and differential tests, render checked ASTs | **Pilot behind an adapter**                                    |
| XState                    | Highly mature statechart runtime with strong TypeScript support, inspection, graph traversal, and model-based testing          | First-class                                                                                                                                                        | In-process for approval, incident, and tool-protocol state                                     | Closed catalogs for guards, actions, actors, and delays; policy decision adapter and state-transition review view                                 | **Ship as a workflow adjunct**                                 |
| DMN/FEEL                  | Mature notation and modeling ecosystem; production execution is strongest in Camunda/JVM engines                               | `dmn-js` is mature for viewing and editing, not execution; no comparably consolidated TypeScript-native execution path                                             | Camunda/JVM service when decision tables justify another runtime                               | Hit-policy profile, deployment and versioning, decision adapter, FEEL compatibility tests, review/source mapping                                  | **Ship only with an accepted JVM dependency; otherwise pilot** |
| JSON Logic                | Stable, tiny, widely deployed evaluator with a finite JSON form; maintenance and typing are comparatively light                | Straightforward, with types supplied separately                                                                                                                    | In-process behind a strict operator allowlist                                                  | Runtime schema, explicit typing and missing/error semantics, normalization, traces, renderer, removal of custom operations                        | **Prototype or narrow embedded use**                           |
| `json-rules-engine`       | Established JavaScript rules engine with built-in declarations and recent maintenance                                          | Native                                                                                                                                                             | In-process behind closed fact and operator registries                                          | Disable asynchronous and executable facts, close extension points, define precedence and total errors, add canonical renderer and traces          | **Prototype or narrow embedded use**                           |
| Soufflé Datalog           | Mature, active, high-performance Datalog compiler and interpreter with provenance tooling                                      | Integration is centered on generated C++, C++ APIs, SWIG, files, and subprocesses rather than a TypeScript policy SDK                                              | Separate native service or build-stage compiler                                                | Native packaging, process lifecycle, fact marshaling, policy-serving API, sandboxing, renderer, and support ownership                             | **Defer for this TypeScript product**                          |
| TypeScript-native Datalog | Available packages demonstrate feasibility                                                                                     | Current packages are early; for example, `@suss/datalog` is still `0.1.x`                                                                                          | None for the product path                                                                      | Most production, compatibility, provenance, and governance infrastructure                                                                         | **Defer**                                                      |

“Ship” here means mature enough to include after the stated integration and assurance
work, not safe to expose directly to policy authors. It also describes a fit to a
particular policy subset. XState can be production-ready for workflows while being
the wrong universal authorization core; Soufflé can be a mature engine while being
the wrong integration choice.

### Recommended six-month product shape

Use OPA/Rego as the plan-of-record authoring and evaluation path. Build the closed
TypeScript AST as the canonical control for measuring the value of ontology closure,
not as a parallel production core by default. Keep Cedar and other candidate source
policies in their native formalism so the experiment does not force open logic through
the closed ontology. Unify the evaluators at one versioned decision contract and one
review-artifact contract. A decision should include at least `allow`, `deny`, and
`indeterminate`; stable reason and policy identifiers; evaluated facts; missing or
failed dependencies; evaluator and policy versions; and source mappings into the
deterministic review artifact.

Deliver the candidates in four lanes:

1. **Plan-of-record core:** productize OPA/Rego with a restricted profile, typed input
   contract, total decision envelope, deterministic review artifact, trace adapter,
   and bundle governance. Prefer OPA's service or bundle deployment until its
   JavaScript Wasm path independently meets support, security, and parity gates.
2. **Challenger:** harden enough of the existing TypeAgent policy model to run the
   closed-AST experiments faithfully. Do not fund a second production platform unless
   it clears the replacement gates below.
3. **Specialized adjunct:** use XState only for lifecycle policy. Add DMN only when
   decision-table demand is strong enough to justify a JVM execution service; add
   Cedar only where its authorization-specific analysis creates value beyond the POR.
4. **Qualified pilot:** evaluate CEL on the common corpus with a frozen feature
   profile. Promote it only after conformance, differential, resource-limit, and
   missing/error-semantic tests pass.

Do not put JSON Logic, `json-rules-engine`, or a TypeScript-native Datalog engine on
the critical path. They remain useful experimental baselines. Soufflé remains a
credible future choice if recursive relational analysis becomes central enough to
justify a native service.

Evaluator maturity does not supply the product's canonical normalization, review
rendering, source maps, missing/error contract, policy schema versions, provenance,
composition rules, approval workflow, or governance. Those are shared product assets
and should be built once around the common decision contract. This is also what makes
the experiments falsifiable: candidates differ in authored formalism and evaluator,
while review and decision obligations stay fixed.

## Experimental program

The experiments validate the recommendation, quantify its risks, and test whether the
TypeScript challenger clears the replacement bar. They are not a greenfield language
selection. A direct comparison of one TypeScript implementation with one Rego
implementation would confound ontology closure, language semantics, renderer quality,
and authoring style. Use one policy corpus and vary those factors independently.

#### Corpus and ground truth

Build a versioned corpus of 30 to 50 policies sampled from historical policy
requests, incident controls, and approved security requirements before implementing
the candidate profiles. Freeze the inclusion criteria and business-importance weights
before scoring. The corpus should span:

- simple allow and deny dimensions;
- exceptions and deny-overrides precedence;
- missing and unavailable data;
- universal and existential quantification;
- joins across two or more enterprise data sets;
- reusable derived concepts;
- tabular thresholds; and
- stateful approval or incident lifecycles.

For each policy, security and domain reviewers should agree on a machine-readable
decision table over positive, negative, boundary, missing-data, and dependency-error
cases. This table, rather than any implementation, is the behavioral ground truth.
Keep a held-out set so that the language designs are not fitted to every test policy.

#### Experiment 1: closure control

Implement the same finite policy schema and canonical renderer contract once in
TypeScript and once as a closed Rego package. Feed both the same normalized policy
data.

**Hypothesis:** after normalization, the review artifacts and decisions are identical.

**Decision value:** a difference falsifies the claim that equally closed TypeScript
and Rego package surfaces are equivalent on the round-trip property, or exposes an
implementation requirement that the current analysis omits.

#### Experiment 2: expressiveness frontier

Attempt each held-out policy in this order:

1. the closed TypeScript rule algebra;
2. that algebra with CEL conditions;
3. Rego under the explainability contract; and
4. a new closed domain construct, when one concise construct captures a recurring
   rejected pattern.

Record whether the policy is represented exactly, rejected, approximated, or requires
an opaque extension. Also record formal-policy size, number of new concepts, and
renderer changes. Do not count arbitrary callbacks, custom CEL functions, or Rego
built-ins as successful native representation.

**Hypothesis:** CEL covers bounded predicates and collection quantification, while
Rego's unique coverage appears at joins, reusable derivations, and relationships not
anticipated by the schema.

**Decision value:** this locates the actual boundary between schema evolution and open
logic instead of deciding it from illustrative examples.

#### Experiment 3: canonicality under equivalent rewrites

For every representable policy, generate semantics-preserving variants:

- reorder commutative conditions and rules;
- rename local variables and helpers;
- inline and extract helper rules;
- distribute and factor Boolean expressions;
- replace equivalent quantifier forms; and
- split or combine rules with the same effect.

Normalize and render every variant. Compare exact artifact hashes first, then compare
the domain propositions and abstraction boundaries when exact text differs.

Measure:

- **exact stability:** percentage producing byte-identical artifacts;
- **propositional stability:** percentage expressing the same atomic domain claims;
- **abstraction stability:** percentage using the same named concepts and expansion
  depth; and
- **size spread:** maximum variation in artifact length for one policy meaning.

**Hypothesis:** the closed algebra has exact stability after normalization; CEL is
stable within its expression boundary; open Rego preserves propositions but varies in
factoring and abstraction.

#### Experiment 4: seeded-error review

Create formal policies containing one controlled translation error: omitted
condition, wrong quantifier, reversed comparison, widened path, wrong default, wrong
precedence, or collapsed missing and unavailable states. Randomly assign reviewers to
artifacts without showing the formalism or implementation.

Measure error-detection rate, false-alarm rate, review time, and reviewer confidence.
Cross over reviewers on a second set to reduce reviewer-skill effects. Include both
policy writers and security engineers because concise domain prose and logical proof
views may help those groups differently.

**Primary outcome:** seeded-error detection rate, with review time as the principal
secondary outcome. This is the experiment most capable of changing the executive
recommendation.

#### Experiment 5: totality and semantic mutation

Automatically mutate every decision-affecting AST or rule node. Require either a
changed artifact and changed generated case, or a proof that the mutation is
semantically redundant. Separately inject missing fields, dependency failures, type
errors, and empty collections.

Measure unrendered nodes, silent mutations, uncovered decision branches, and cases
where evaluation and prose disagree.

**Hypothesis:** totality is easiest to enforce structurally in the closed algebra;
Rego and CEL can match it only when their profiles require total structured decisions
and explicit failure semantics.

#### Experiment 6: provenance usefulness

For concrete allow, deny, and indeterminate decisions, show reviewers one of three
views: canonical prose only, prose plus a condition trace, or prose plus a derivation
graph. Ask them to identify the decisive facts and the smallest fact change that would
reverse the decision.

**Decision value:** if derivation graphs materially improve accuracy on relational
policies, Datalog-like provenance should be required even when the authoring surface
is closed. If traces perform equally well, a simpler AST evaluator is sufficient.

#### Specialized controls

Run Cedar only on the subset independently classified as
principal-action-resource authorization. Run DMN as an alternate review and authoring
view for independently classified tabular policies. Run XState only on lifecycle
policies, with guards restricted to the same closed condition catalog. These tests ask
whether a specialized formalism wins in its natural domain; they should not be used to
claim universal coverage.

#### Plan-of-record validation and replacement gates

Set final thresholds before examining results. Because OPA/Rego is the plan of record,
the null decision is to keep it. Reasonable starting gates are:

- Keep OPA/Rego unless the TypeScript challenger satisfies every replacement gate.
- Require exact representation of every business-critical held-out policy and at
  least 97% of the full weighted corpus without opaque extensions. Coverage above
  this floor does not itself count as a win.
- Require a large review advantage: either at least a 10-percentage-point absolute
  increase in seeded-error detection with no material review-time regression, or at
  least a 30% reduction in median review time with seeded-error detection no more than
  two percentage points lower. Evaluate confidence intervals and the preregistered
  statistical test, not point estimates alone.
- Require no material regression in decision correctness, missing/error behavior,
  provenance usefulness, policy-change latency, or support for critical relational
  policies.
- Require the measured benefit to exceed the separately budgeted migration and
  duplicated-platform cost threshold. Include policy conversion, retraining,
  operational tooling, governance, and the option value of Rego's existing ecosystem.
- Add CEL, Cedar, DMN, or XState only as specialized adjuncts when they clear their own
  incremental-value and operating-cost gates; none changes the core POR by default.
- Require derivation provenance independently of language if it improves root-cause
  accuracy by a preregistered meaningful margin.

These are initial decision thresholds, not claims about expected results. The product
owner should set the migration-cost threshold and statistical design before the
corpus is scored. Weight policies by business importance, and publish both weighted
and unweighted scores so a large set of trivial policies cannot hide a small set of
critical relational ones.

### Closed schema packages in Rego or TypeScript

A third design closes policy one package at a time. For example, the enterprise might
publish separate packages for file access, customer communications, production
deployment, and database export. Each package defines:

- its accepted policy data;
- its finite registry of semantic leaves, pairing each unambiguous natural-language
  description with an executable predicate;
- its input and external-data contract;
- its complete decision semantics;
- its precedence, missing-data, and error behavior;
- its canonical renderer; and
- its package and schema version.

Rego can implement such a package behind a fixed entry point:

```rego
package enterprise.file_access.v1

decision := result if {
    policy := data.policy.file_access
    result := evaluate(policy, input)
}
```

TypeScript can implement the same package boundary:

```typescript
export interface FileAccessPolicyV1 {
  default: "allow" | "deny";
  rules: FileAccessRuleV1[];
}

export function evaluate(
  policy: FileAccessPolicyV1,
  input: FileAccessInput,
): Decision;
```

The fixed `decision` or `evaluate` interface alone is not enough to establish a closed
policy language. Closure can occur at three distinct levels:

1. **Interface closure:** callers receive one fixed decision shape.
2. **Policy-surface closure:** authors may supply only a finite set of declared policy
   constructs.
3. **Implementation closure:** the evaluator itself uses only a constrained set of
   operations.

Round-trip assurance primarily follows from policy-surface closure and the semantic
leaf contract. A Rego package whose exported result is fixed but whose policy authors
may add arbitrary rules still has an open policy surface. Its interface is closed,
but its policies retain the canonical-explanation problem. A Rego package whose
authored policies are validated against finite data variants, whose leaves pair
registered descriptions with deterministic predicates, and whose renderer is total
over those variants is a genuine closed schema package, even if its trusted evaluator
uses unrestricted Rego internally.

TypeScript is equally expressive at adding a new closed schema: define a new tagged
union or validated data model, evaluator, normalizer, and total renderer, then register
the versioned package. Rego can do the same with validated policy data, package rules,
and a renderer contract. Neither language has an intrinsic expressiveness advantage
for adding a new finite ontology.

The practical semantic distinction appears only when package authors need open logic:

- Rego can make relational rules, joins, and quantifiers the package's native
  implementation or authoring model.
- TypeScript can compute the same decidable relationships in code, so it is not less
  computationally expressive. However, arbitrary TypeScript code is imperative
  program logic rather than a declarative closed policy representation and is no
  easier to reverse canonically.

Therefore the meaningful comparison is between the **published policy surfaces**, not
between the languages used to implement their evaluators.

## Concrete distinctions

The examples below assume perfect validators, normalizers, renderers, and source maps
for both formalisms. They isolate differences that remain after implementation
quality is equalized.

### Example 1: fixed allow and deny dimensions

**Original policy**

> Deny web search. Allow file reads under `/work`, except credentials. Deny all
> other tool calls.

**Closed schema**

```json
{
  "default": "deny",
  "tools": [{ "effect": "deny", "names": ["web_search"] }],
  "paths": [
    { "effect": "allow", "operation": "read", "patterns": ["/work/**"] },
    { "effect": "deny", "patterns": ["**/credentials/**"] }
  ],
  "precedence": "deny-overrides"
}
```

**Canonical reverse description**

> By default, tool calls are denied. File reads are allowed under `/work`, except
> paths under a `credentials` directory. Web search is denied. A deny rule overrides
> an allow rule.

The schema has a clear advantage here. The formal structure already uses the policy
writer's concepts: default, operation, path, exception, and precedence. A complete
renderer is direct and the result has one canonical organization.

**Rego**

```rego
default allow := false

allow if {
    input.tool.name == "read_file"
    glob.match("/work/**", [], input.resource.path)
    not credential_path
}

credential_path if {
    glob.match("**/credentials/**", [], input.resource.path)
}
```

An ideal Rego renderer can produce the same prose. To do so, it must infer or be told
that `credential_path` is an exception, that the absent successful `allow` is a deny,
and that these rules should be presented as one path policy rather than two logical
definitions. This is solvable, but the domain organization is not inherent in the
general rule structure.

**Distinctive result:** for policies that align with predefined dimensions, the
closed schema yields a more direct and more reliably canonical round trip.

### Example 2: a new relationship between existing concepts

**Original policy**

> An agent may send a customer email only when every recipient belongs to an account
> assigned to the requesting employee, unless an active incident authorizes the
> account.

**Rego**

```rego
default allow := false

allow if {
    input.tool.name == "send_email"
    every recipient in input.tool.arguments.recipients {
        account := data.customers.by_email[recipient].account_id
        account in data.employees[input.principal.user_id].assigned_accounts
    }
}

allow if {
    input.tool.name == "send_email"
    some recipient in input.tool.arguments.recipients
    account := data.customers.by_email[recipient].account_id
    data.incidents.authorized_accounts[account]
}
```

**Deterministic reverse description**

> Customer email is allowed when either:
>
> 1. every recipient's account is assigned to the requesting employee; or
> 2. at least one recipient's account is authorized by an active incident.

The reverse description immediately exposes a likely formalization error: “unless an
active incident authorizes the account” was translated as authorization of at least
one recipient's account, which may allow the entire email. The writer can reject the
translation.

Rego has a clear advantage in expressibility. The policy introduces joins across
recipients, customers, employees, and incidents, together with universal and
existential quantification. These are native logical relationships.

A closed schema can represent this only if it already contains an expression language
for joins and quantifiers, or if a new domain construct is added, for example:

```json
{
  "effect": "allow",
  "tool": "send_email",
  "when": {
    "every": {
      "items": "arguments.recipients",
      "satisfies": {
        "relation": "recipient_account_assigned_to_principal"
      }
    }
  }
}
```

If `relation` is an open extension point, its meaning and rendering must be registered
somewhere. If `when` becomes a general expression tree, the schema is moving toward a
general policy language and its renderer inherits the same abstraction problem.

**Distinctive result:** Rego handles unforeseen relational policy without language
evolution; the closed schema must reject it, evolve, or become less closed.

### Example 3: equivalent policy, different formal shape

**Original policy**

> Production deployment requires both an approved change request and membership in
> the release-manager group.

One Rego author may write one rule:

```rego
allow if {
    input.tool.name == "deploy"
    input.environment == "production"
    data.changes[input.change_id].approved
    data.groups.release_managers[input.principal.user_id]
}
```

Another may factor it:

```rego
approved_change if data.changes[input.change_id].approved

release_manager if data.groups.release_managers[input.principal.user_id]

allow if {
    production_deployment
    approved_change
    release_manager
}
```

A third may compute a set of authorized principals and test membership. All three can
be extensionally equivalent for the relevant input model.

An ideal Rego renderer can always describe each rule graph completely. Producing the
same canonical executive sentence from every equivalent formulation is harder: it
requires inlining decisions, equivalence-preserving simplification, and domain naming.
Helper names improve prose when they are good and degrade it when they are misleading.

In a closed schema, equivalent policies normalize to the same predefined fields and
operators, assuming the concept is in the ontology. Local factoring is not part of the
policy surface.

**Distinctive result:** the closed schema can guarantee stronger representational
canonicality. Rego can guarantee syntactic normalization and complete logical
rendering, but domain-level canonicality requires an authoring discipline or profile.

### Example 4: reusable enterprise abstraction

**Original policy**

> High-impact tools require a trusted operator.

The enterprise defines “trusted operator” as a reusable concept involving training,
employment status, current risk score, and emergency suspension.

Rego can define the abstraction once and use it across policies:

```rego
trusted_operator(user_id) if {
    data.people[user_id].employment_status == "active"
    data.training[user_id].security_tools == "current"
    data.risk[user_id].score < 40
    not data.suspensions[user_id]
}
```

An ideal reverse compiler has two legitimate outputs:

> High-impact tools require a trusted operator.

or the expanded form:

> High-impact tools require an active employee whose security-tools training is
> current, whose risk score is below 40, and who is not suspended.

The first is concise but incomplete unless “trusted operator” is defined elsewhere in
the artifact. The second is complete but repeats detail wherever the abstraction is
used. A layered artifact can solve the presentation problem with a glossary and rule
graph, but there is no single universally best expansion depth.

A closed schema must make `trustedOperator` a first-class registered predicate or
encode its internals in a generic condition language. Registration gives excellent
round-trip prose after schema evolution; generic conditions give flexibility while
reducing the closed-world guarantee.

**Distinctive result:** Rego supports policy-local abstraction naturally. The closed
schema supports exceptionally clear abstraction only after the enterprise promotes
that concept into its ontology.

### Example 5: absence, undefined data, and defaults

**Original policy**

> Deny database export unless the request has a valid data classification.

The review artifact must distinguish at least these cases:

| Classification state               | Required decision                        |
| ---------------------------------- | ---------------------------------------- |
| Present and valid                  | Continue evaluating export conditions    |
| Present and invalid                | Deny                                     |
| Missing                            | Deny                                     |
| Classification service unavailable | Deny and report indeterminate dependency |

A closed schema can require every policy construct to declare missing-data and error
behavior. Its renderer can always print the completed table. This is verbose in the
formal model but strong for review.

Rego can express all four outcomes, including a structured decision object. However,
undefined values and failed expressions participate in the language's logical
semantics. An ideal enterprise profile would need to require explicit total decisions
and dependency-status handling. Once required, the reverse compiler can render the
same table.

**Distinctive result:** ideal implementations can tie here, but the closed schema can
make totality structural. Rego needs a policy contract or restricted profile to make
totality mandatory.

### Example 6: adding a new closed schema package

**New policy domain**

> Introduce a package for production deployments. It supports environment, change
> approval, operator role, deployment window, and emergency override. No other
> conditions are valid in version 1.

A TypeScript implementation can add `ProductionDeploymentPolicyV1` as a tagged data
model together with its validator, evaluator, and renderer. A Rego implementation can
add `enterprise.production_deployment.v1`, validate policy data against the same
finite variants, evaluate it relationally, and render those variants through the same
domain templates.

Both can produce the same canonical reverse description:

> Production deployment is denied by default. It is allowed for a release manager
> during the deployment window when the change is approved. An active emergency
> override permits deployment outside the window. Missing approval or operator-role
> data causes denial.

In both implementations, adding `customerRiskScore` later changes the ontology and
requires a versioned schema and renderer update. Adding a helper function or helper
rule only changes implementation and does not change the policy language.

If the Rego package instead allows policy authors to add arbitrary rule bodies under
the package name, it is no longer a closed schema package. If the TypeScript package
allows policy authors to supply arbitrary callback predicates, it has crossed the same
boundary. A callback or rule becomes an eligible closed-schema leaf only when the
package registers both its unambiguous natural-language meaning and its deterministic
executable predicate as one versioned entry.

**Distinctive result:** TypeScript and Rego are equally expressive at adding a new
closed schema package. The round-trip property depends on whether the package's
authored policy surface remains finite and renderable, not on its implementation
language.

## What ideal implementation cannot erase

Perfect engineering can remove parser bugs, weak validation, poor diagnostics, and
tooling gaps. It cannot remove these structural tradeoffs:

| Question                                                                                 | Closed TypeScript schema                                        | Unrestricted Rego                                                                     | Closed Rego package                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Can every valid construct have a predefined domain rendering?                            | Yes                                                             | Only under a restricted domain profile                                                | Yes                                                          |
| Can a new finite schema package be added?                                                | Yes                                                             | Yes                                                                                   | Yes                                                          |
| Can a new relationship be authored without changing a schema or registering a predicate? | No                                                              | Yes                                                                                   | No                                                           |
| Can completeness be proved by visiting every authored policy node?                       | Yes, with a total renderer                                      | Logical-node coverage is possible; domain-level abstraction remains a separate choice | Yes, with a total renderer over package policy data          |
| Can semantically equivalent policies normalize to one domain representation?             | Usually, when the concept exists in the ontology                | Not in general without conventions and semantic simplification                        | Usually, when authors use only declared package variants     |
| Can enterprise abstractions be introduced locally by policy authors?                     | Only through an extension mechanism or generic expression model | Yes, through named rules and functions                                                | Only through a package revision or declared extension point  |
| Is concise prose independent of author factoring and naming?                             | Largely yes                                                     | No; factoring and names affect the natural explanation                                | Largely yes                                                  |
| Is decision provenance native to the policy representation?                              | Not necessarily; it depends on the evaluator                    | Yes under a Datalog-like rule profile                                                 | Yes when package internals expose relational derivations     |
| Is rule meaning independent of source order and evaluation strategy?                     | Yes for policy data; evaluator behavior is separately specified | Yes under a pure or suitably restricted Datalog-like profile                          | Yes when the package contract requires that profile          |
| What happens outside the supported policy vocabulary?                                    | The policy is rejected until the schema evolves                 | The policy can usually be expressed                                                   | The policy is rejected until a package is added or versioned |

## Product decision and guardrails

Adopt OPA/Rego with an explainability contract. Require each policy to provide:

- a total structured decision, including deny and indeterminate outcomes;
- a Datalog-like rule profile where its restrictions can express the required policy;
- typed input and data contracts;
- stable rule identifiers and domain titles;
- explicit external dependencies;
- controlled built-ins and deterministic evaluation;
- generated rule and dependency graphs; and
- a deterministic logical rendering with both summarized and expanded views.

The review artifact must disclose when prose depends on author-supplied names or
annotations rather than semantics inferred from the rule body.

Use closed Rego packages for stable domains such as file access, customer
communications, production deployment, and database export. Each package should
define finite policy data, a semantic leaf registry satisfying both representation
requirements, explicit composition and conflict rules, complete missing/error
behavior, and a total renderer. Keep open Rego for cross-domain and unforeseen
relational policy.

Do not build the TypeScript challenger into a production peer unless it clears every
replacement gate. Its role is to reveal how much canonical review quality is left on
the table and whether that difference is large enough to justify switching.

## Architecture guardrail

This guardrail prevents the recommended Rego profile from silently becoming either an
unreviewable general-purpose language or a closed schema under another syntax.

1. List every Rego restriction needed to guarantee the desired reverse description.
2. If those restrictions leave only predefined policy fields and condition variants,
   compare that profile to the closed schema as two syntaxes for the same ontology.
3. Repeat the comparison for a catalog of closed packages. A fixed package decision
   API and finite authorable surface do not count as policy closure unless every
   semantic leaf also satisfies the dual-representation contract.
4. List every extension mechanism needed to make the TypeScript schema practical.
5. If those mechanisms allow arbitrary predicates or expression trees, evaluate it as
   a general policy language, not as a closed schema.

The deployed intermediary should be described by its actual semantic boundary, not by
its file extension.

## Intune under the leaf contract

Microsoft Intune is useful evidence for a catalog architecture, but its policy
surfaces must be classified leaf by leaf under this definition:

- A Settings Catalog entry is a candidate closed-schema leaf when its definition
  supplies an unambiguous human meaning and the platform supplies deterministic,
  documented application or compliance semantics for that exact definition and
  value type.
- A Graph resource type, `settingDefinitionId`, friendly name, or console control is
  insufficient on its own. Those artifacts establish structure and identity, not the
  complete executable meaning of the setting.
- A custom OMA-URI, imported ADMX or Apple payload, script, or other opaque extension
  is not a closed leaf unless a separate versioned registry supplies both required
  representations and validates the payload against them.
- Assignment-filter text is not closed merely because it is stored in a typed Graph
  property. It qualifies only if Intune's finite expression grammar and property
  semantics are part of the pinned schema and every atomic predicate has the required
  description and deterministic evaluator.

Consequently, Intune is best described as a **hybrid catalog with potentially closed
packages and explicit open extensions**, not as proof that its entire policy model is
closed. The public Settings Definitions spreadsheets are useful inventory snapshots,
but their identifiers, friendly names, primitive types, and applicability metadata do
not by themselves publish the executable predicate required by this definition.

## Ten-slide presentation spine

The presentation should make one argument, not reproduce the full comparison. The
recommended slide sequence is:

1. **Recommendation:** retain OPA/Rego as the AI tool-policy intermediary and add an
   enterprise explainability profile.
2. **The product problem:** AI translates natural-language intent into enforceable
   policy; humans need a deterministic artifact that reveals translation errors before
   deployment.
3. **What matters:** complete, concise, deterministic, canonical, and traceable review,
   plus coverage of policies the enterprise has not anticipated yet.
4. **The central tradeoff:** closed TypeScript gives stronger canonical review inside
   a fixed ontology; Rego gives expressive headroom across an evolving ontology.
5. **Why Rego wins:** relational coverage, declarative provenance, production maturity,
   and plan-of-record economics outweigh the remaining canonicality gap.
6. **What we preserve from the closed model:** versioned closed Rego packages, total
   decisions, typed contracts, controlled built-ins, and deterministic renderers.
7. **Show the difference:** contrast one fixed-dimension policy where the closed model
   renders better with one unforeseen relationship that Rego expresses without a
   language release.
8. **Product architecture:** OPA service or bundles, common decision and review
   contracts, closed packages for stable domains, and open Rego for relational policy.
9. **Risks and mitigations:** author factoring, undefined data, noncanonical prose, and
   Wasm maturity are addressed by the profile, provenance, totality, and deployment
   choices.
10. **Decision and next steps:** fund the Rego production path, run the TypeScript
    challenger experiment, and switch only if it clears every large-margin replacement
    gate.

The evidence slides should use concrete artifacts rather than feature matrices. For
each example, show `source policy -> formal policy -> deterministic review artifact`
and ask whether a policy writer can detect the seeded error.

## Round-trip acceptance tests

All three ideal architectures should be judged by the same tests:

1. **Leaf registry completeness:** every permitted semantic leaf has exactly one
   versioned entry pairing an unambiguous natural-language description with a
   deterministic executable predicate.
2. **Leaf rejection:** validation rejects unregistered leaves and registered leaves
   missing either representation.
3. **Leaf conformance:** generated positive, negative, missing-data, error, and
   boundary cases verify that each description and executable predicate agree.
4. **Node coverage:** every decision-affecting formal node maps to the artifact.
5. **Semantic mutation:** changing any decision-affecting node changes the artifact.
6. **Boundary generation:** every rendered condition generates positive, negative,
   missing-data, and boundary-value examples.
7. **Metamorphic stability:** formatting, ordering, and local renaming do not change
   the artifact.
8. **Factoring stability:** equivalent inlining and helper-rule extraction reveal how
   much the artifact depends on formal shape.
9. **Abstraction disclosure:** every summarized concept links to its complete
   definition and dependencies.
10. **Derivation provenance:** every concrete decision links to the facts and rule
    instances sufficient to derive it, or to the failed conditions that prevented it.
11. **Seeded-error review:** policy writers detect omitted conditions, broadened
    permissions, narrowed permissions, wrong quantifiers, wrong precedence, and wrong
    defaults.

The primary score is seeded-error detection rate, conditioned on review time. Artifact
length is relevant only after completeness and detection are established.

## Final recommendation

Retain OPA/Rego as the plan-of-record intermediary for AI tool policy. Productize a
governed Rego profile and deterministic review contract rather than replacing Rego
with a closed TypeScript language. Use closed Rego packages wherever the policy domain
is stable enough to gain structural rendering guarantees, and preserve open relational
rules for policies that cross domains or introduce new relationships.

Build the TypeScript closed algebra only as the strongest challenger and measurement
control. Its canonical-review advantage is real, but changing the plan of record is
justified only by a large demonstrated improvement in policy-writer error detection or
review time, with no critical coverage loss and with benefits exceeding the full cost
of migration and a second policy platform.
