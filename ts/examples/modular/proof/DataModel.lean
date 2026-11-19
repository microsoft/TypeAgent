/-
Pilot: properties of the design in dataModel.ts, proved in Lean 4 (core
only, no Mathlib). Each definition below translates a rule or a
vocabulary function by hand; its comment names the source. The theorems
are about the design: they involve no implementation.

What a process call does, as the rules see it: `queued` is what was
enqueued since the previous process call, in enqueue order
(queuedSince in dataModel.vocab.ts); `log` is what logOperations reported
during the call (logged).
-/

/-- Operation (dataModel.ts), with only the fields these rules use. seq is
-1 while a local operation is pending. TypeScript numbers are modelled as
integers: Operation's @valid rules say these fields are integers. -/
structure Op where
  clientId : String
  clientSeq : Int
  seq : Int
deriving DecidableEq

/-- isStrictlySorted (rules.ts) with compare a b = key a - key b: every
element compares below every later one, which is List.Pairwise. -/
def StrictlySorted (key : Op → Int) (xs : List Op) : Prop :=
  xs.Pairwise (fun a b => key a < key b)

/-- The key sameOps (dataModel.vocab.ts) tells operations apart by. -/
def key (o : Op) : String × Int × Int := (o.clientId, o.clientSeq, o.seq)

/-- sameOps: the same operations, each as often: a permutation of keys. -/
def SameOps (a b : List Op) : Prop := List.Perm (a.map key) (b.map key)

def isLocal (o : Op) : Bool := o.seq == -1

/-! ## Rules -/

/-- MessageProcessor.remote-seq (a @requires, headline only): each remote
operation has an assigned seq, greater than any earlier remote one's. -/
def RemoteSeq (remotes : List Op) : Prop :=
  (∀ o ∈ remotes, 0 ≤ o.seq) ∧ remotes.Pairwise (fun a b => a.seq < b.seq)

/-- MessageProcessor.client-order (a @requires, headline only): each
client's operations arrive on remote in clientSeq order. -/
def ClientOrder (remotes : List Op) : Prop :=
  remotes.Pairwise (fun a b => a.clientId = b.clientId → a.clientSeq < b.clientSeq)

/-- MessageProcessor.stamps, the part these rules need: local operations
are pending, with clientSeqs growing in enqueue order. -/
def Stamps (locals : List Op) : Prop :=
  (∀ o ∈ locals, o.seq = -1) ∧ locals.Pairwise (fun a b => a.clientSeq < b.clientSeq)

/-- MessageProcessor.local-order:
isStrictlySorted(logged(this).filter((op) => op.seq === -1), (a, b) => a.clientSeq - b.clientSeq) -/
def LocalOrder (log : List Op) : Prop :=
  StrictlySorted (·.clientSeq) (log.filter isLocal)

/-- MessageProcessor.remote-order:
isStrictlySorted(logged(this).filter((op) => op.seq !== -1), (a, b) => a.seq - b.seq) -/
def RemoteOrder (log : List Op) : Prop :=
  StrictlySorted (·.seq) (log.filter (fun o => !isLocal o))

/-- MessageProcessor.process.logs-each: sameOps(logged(this), queuedSince(this)) -/
def LogsEach (log queued : List Op) : Prop := SameOps log queued

/-! ## 1. A derivation in task 9's text

"Each client's operations are sequenced in clientSeq order
(MessageProcessor.client-order), so a client's seqs grow with its
clientSeqs." It follows from client-order and remote-seq. -/

theorem seqs_grow_with_clientSeqs (r : List Op)
    (hc : ClientOrder r) (hs : RemoteSeq r) :
    r.Pairwise (fun a b => a.clientId = b.clientId → a.clientSeq < b.clientSeq ∧ a.seq < b.seq) := by
  have := List.Pairwise.and hc hs.2
  exact this.imp (fun ⟨h1, h2⟩ hid => ⟨h1 hid, h2⟩)

/-! ## 2. remote-order's gloss

"Remote operations are applied in the order they were enqueued, which is
seq order." If the log applies the remote operations in the order they
were queued, remote-seq makes the rule's expression hold. -/

theorem remote_order_is_seq_order (remotes : List Op) (hs : RemoteSeq remotes) :
    StrictlySorted (·.seq) remotes := hs.2

/-! ## 3. Consistency of local-order, remote-order and logs-each

For any queue the requirements allow, a log exists that satisfies all
three: the queued local operations in order, then the remote ones. The
remote-first log satisfies them too, so these rules leave the order in
which process takes the queues open. -/

theorem filter_local_of_locals (l : List Op) (h : ∀ o ∈ l, o.seq = -1) :
    l.filter isLocal = l := by
  rw [List.filter_eq_self]
  intro o ho
  simp [isLocal, h o ho]

theorem filter_local_of_remotes (r : List Op) (h : ∀ o ∈ r, 0 ≤ o.seq) :
    r.filter isLocal = [] := by
  rw [List.filter_eq_nil_iff]
  intro o ho
  have := h o ho
  simp [isLocal]
  omega

theorem filter_remote_of_locals (l : List Op) (h : ∀ o ∈ l, o.seq = -1) :
    l.filter (fun o => !isLocal o) = [] := by
  rw [List.filter_eq_nil_iff]
  intro o ho
  simp [isLocal, h o ho]

theorem filter_remote_of_remotes (r : List Op) (h : ∀ o ∈ r, 0 ≤ o.seq) :
    r.filter (fun o => !isLocal o) = r := by
  rw [List.filter_eq_self]
  intro o ho
  have := h o ho
  simp [isLocal]
  omega

/-- The queued operations, split by the processor into its two queues. -/
def locals (queued : List Op) : List Op := queued.filter isLocal
def remotes (queued : List Op) : List Op := queued.filter (fun o => !isLocal o)

theorem locals_pending (q : List Op) : ∀ o ∈ locals q, o.seq = -1 := by
  intro o ho
  simp [locals, isLocal, List.mem_filter] at ho
  exact ho.2

theorem consistent_local_first (q : List Op)
    (hl : Stamps (locals q)) (hr : RemoteSeq (remotes q)) :
    let log := locals q ++ remotes q
    LocalOrder log ∧ RemoteOrder log ∧ LogsEach log q := by
  intro log
  refine ⟨?_, ?_, ?_⟩
  · simp only [LocalOrder, StrictlySorted, log, List.filter_append,
      filter_local_of_locals _ hl.1, filter_local_of_remotes _ hr.1, List.append_nil]
    exact hl.2
  · simp only [RemoteOrder, StrictlySorted, log, List.filter_append,
      filter_remote_of_locals _ hl.1, filter_remote_of_remotes _ hr.1, List.nil_append]
    exact hr.2
  · simp only [LogsEach, SameOps, log, locals, remotes]
    exact List.Perm.map key (List.filter_append_perm isLocal q)

theorem consistent_remote_first (q : List Op)
    (hl : Stamps (locals q)) (hr : RemoteSeq (remotes q)) :
    let log := remotes q ++ locals q
    LocalOrder log ∧ RemoteOrder log ∧ LogsEach log q := by
  intro log
  refine ⟨?_, ?_, ?_⟩
  · simp only [LocalOrder, StrictlySorted, log, List.filter_append,
      filter_local_of_locals _ hl.1, filter_local_of_remotes _ hr.1, List.nil_append]
    exact hl.2
  · simp only [RemoteOrder, StrictlySorted, log, List.filter_append,
      filter_remote_of_locals _ hl.1, filter_remote_of_remotes _ hr.1, List.append_nil]
    exact hr.2
  · simp only [LogsEach, SameOps, log, locals, remotes]
    exact List.Perm.map key (List.perm_append_comm.trans (List.filter_append_perm isLocal q))
