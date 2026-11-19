/-
Properties of the undo list's design (list.ts), proved in Lean 4 (core
only, no Mathlib). Each definition translates a rule or a vocabulary
function by hand; its comment names the source. The theorems are about
the design: they involve no implementation.

The state is what a reader observes: items, past and future. length,
canUndo and canRedo are defined from them by the @invariant rules
(length, can-undo, can-redo), and reading changes nothing (read-only),
so the state below is all a rule can see. Indexes are natural numbers:
the @requires in-range rules say they are integers from 0.
-/

/-- Op (list.ts). -/
inductive Op where
  | add (index : Nat) (text : String)
  | remove (index : Nat) (text : String)
  | replace (index : Nat) (text was : String)
deriving DecidableEq, Repr

/-- apply (list.vocab.ts): the items with op applied; with no op, unchanged. -/
def apply : Option Op → List String → List String
  | none, items => items
  | some (.add i t), items => items.take i ++ t :: items.drop i
  | some (.remove i _), items => items.take i ++ items.drop (i + 1)
  | some (.replace i t _), items => items.set i t

/-- unapply (list.vocab.ts): the items with op reversed; with no op, unchanged. -/
def unapply : Option Op → List String → List String
  | none, items => items
  | some (.add i _), items => items.take i ++ items.drop (i + 1)
  | some (.remove i t), items => items.take i ++ t :: items.drop i
  | some (.replace i _ w), items => items.set i w

/-- What a reader observes. -/
structure State where
  items : List String
  past : List Op
  future : List Op
deriving DecidableEq, Repr

/-- List.empty (@initially): no items and nothing to undo or redo. -/
def initial : State := ⟨[], [], []⟩

/-- A call on a List that changes something. -/
inductive Call where
  | add (index : Nat) (text : String)
  | remove (index : Nat)
  | replace (index : Nat) (text : String)
  | undo
  | redo

/-! ## Rules -/

/-- The @requires rules: add's in-range (0 <= index <= length), remove's
and replace's in-range (0 <= index < length). undo and redo have none. -/
def Requires (s : State) : Call → Prop
  | .add i _ => i ≤ s.items.length
  | .remove i => i < s.items.length
  | .replace i _ => i < s.items.length
  | .undo => True
  | .redo => True

/-- The @ensures rules of each call, as a relation between the state
before (s) and after (s').
- add: inserts, records.
- remove: removes, records (the text it removed is old(this.items)[index]).
- replace: replaces, records.
- undo: undoes. old(this.past).slice(-1) is the last op as a list.
- redo: redoes. -/
def Ensures (s : State) : Call → State → Prop
  | .add i t, s' =>
      s'.items = s.items.take i ++ t :: s.items.drop i ∧
      s'.past = s.past ++ [.add i t] ∧ s'.future = []
  | .remove i, s' =>
      s'.items = s.items.take i ++ s.items.drop (i + 1) ∧
      s'.past = s.past ++ [.remove i (s.items[i]?.getD "")] ∧ s'.future = []
  | .replace i t, s' =>
      s'.items = s.items.set i t ∧
      s'.past = s.past ++ [.replace i t (s.items[i]?.getD "")] ∧ s'.future = []
  | .undo, s' =>
      s'.items = unapply s.past.getLast? s.items ∧
      s'.past = s.past.dropLast ∧
      s'.future = s.past.getLast?.toList ++ s.future
  | .redo, s' =>
      s'.items = apply s.future.head? s.items ∧
      s'.past = s.past ++ s.future.take 1 ∧
      s'.future = s.future.drop 1

/-! ## The rules determine every call

Each call's @ensures rules fix all three parts of the state, so there is
exactly one state after each call: `step`. -/

def step (s : State) : Call → State
  | .add i t => ⟨s.items.take i ++ t :: s.items.drop i, s.past ++ [.add i t], []⟩
  | .remove i => ⟨s.items.take i ++ s.items.drop (i + 1), s.past ++ [.remove i (s.items[i]?.getD "")], []⟩
  | .replace i t => ⟨s.items.set i t, s.past ++ [.replace i t (s.items[i]?.getD "")], []⟩
  | .undo => ⟨unapply s.past.getLast? s.items, s.past.dropLast, s.past.getLast?.toList ++ s.future⟩
  | .redo => ⟨apply s.future.head? s.items, s.past ++ s.future.take 1, s.future.drop 1⟩

/-- Consistency: the state step gives satisfies the rules. -/
theorem consistent (s : State) (c : Call) : Ensures s c (step s c) := by
  cases c <;> simp [Ensures, step]

/-- Determinacy: any state that satisfies the rules is step's. -/
theorem determined (s s' : State) (c : Call) (h : Ensures s c s') : s' = step s c := by
  obtain ⟨items, past, future⟩ := s'
  cases c <;> simp_all [Ensures, step]

/-! ## Edit then undo -/

/-- The op an edit records. -/
def recorded (s : State) : Call → Option Op
  | .add i t => some (.add i t)
  | .remove i => some (.remove i (s.items[i]?.getD ""))
  | .replace i t => some (.replace i t (s.items[i]?.getD ""))
  | _ => none

/-- An op can be applied to items: what its call's @requires asks, and,
for remove and replace, the text it records is the item it changes. -/
def valid (items : List String) : Op → Bool
  | .add i _ => decide (i ≤ items.length)
  | .remove i t => decide (i < items.length) && items[i]?.getD "" == t
  | .replace i _ w => decide (i < items.length) && items[i]?.getD "" == w

theorem take_of_prefix (items rest : List String) (i : Nat) (h : i ≤ items.length) :
    (items.take i ++ rest).take i = items.take i := by
  have hl : (items.take i).length = i := by simp [h]
  conv => lhs; rw [← hl]
  simp

theorem drop_of_prefix (items rest : List String) (i : Nat) (h : i ≤ items.length) :
    (items.take i ++ rest).drop i = rest := by
  have hl : (items.take i).length = i := by simp [h]
  conv => lhs; rw [← hl]
  simp

theorem split_at (items : List String) (i : Nat) (h : i < items.length) :
    items.take i ++ items[i] :: items.drop (i + 1) = items := by
  rw [List.getElem_cons_drop]; simp

/-- Undoing an op restores the items it was applied to. -/
theorem unapply_apply (items : List String) (op : Op) (h : valid items op = true) :
    unapply (some op) (apply (some op) items) = items := by
  cases op with
  | add i t =>
    simp [valid] at h
    have hd : (items.take i ++ t :: items.drop i).drop (i + 1) = items.drop i := by
      rw [← List.drop_drop, drop_of_prefix _ _ _ h]; simp
    simp only [apply, unapply, take_of_prefix _ _ _ h, hd, List.take_append_drop]
  | remove i t =>
    simp [valid] at h
    obtain ⟨hi, ht⟩ := h
    have hle : i ≤ items.length := Nat.le_of_lt hi
    simp only [apply, unapply, take_of_prefix _ _ _ hle, drop_of_prefix _ _ _ hle]
    have : items[i]?.getD "" = items[i] := by simp [hi]
    rw [← ht, this, split_at _ _ hi]
  | replace i t w =>
    simp [valid] at h
    obtain ⟨hi, hw⟩ := h
    have : items[i]?.getD "" = items[i] := by simp [hi]
    simp only [apply, unapply, List.set_set]
    rw [← hw, this, List.set_getElem_self]

/-- An edit's call, when its @requires holds, records a valid op, and
applying that op gives the items its @ensures rules give. -/
theorem edit_records (s : State) (c : Call) (op : Op) (hc : recorded s c = some op) (hr : Requires s c) :
    valid s.items op = true ∧ (step s c).items = apply (some op) s.items ∧
    (step s c).past = s.past ++ [op] ∧ (step s c).future = [] := by
  cases c <;> simp [recorded] at hc <;> subst hc <;> simp_all [Requires, valid, step, apply]

/-! ## Edit then undo restores the items -/

theorem undo_eq (t : State) :
    step t .undo = ⟨unapply t.past.getLast? t.items, t.past.dropLast, t.past.getLast?.toList ++ t.future⟩ := rfl

theorem edit_then_undo (s : State) (c : Call) (op : Op) (hc : recorded s c = some op) (hr : Requires s c) :
    (step (step s c) .undo).items = s.items ∧ (step (step s c) .undo).past = s.past := by
  obtain ⟨hv, hi, hp, _⟩ := edit_records s c op hc hr
  rw [undo_eq, hi, hp]
  simp [unapply_apply _ _ hv]

/-! ## Reachable states

replay applies ops in order, from the oldest, and fails if one isn't
valid. A reachable state's items are its past replayed on the empty
list, and its future replays on its items. -/

def replay : List Op → List String → Option (List String)
  | [], items => some items
  | op :: ops, items => if valid items op then replay ops (apply (some op) items) else none

theorem replay_append (ps qs : List Op) (items : List String) :
    replay (ps ++ qs) items = (replay ps items).bind (replay qs) := by
  induction ps generalizing items with
  | nil => simp [replay]
  | cons op ps ih => by_cases h : valid items op <;> simp [replay, h, ih]

def Reachable (s : State) : Prop :=
  replay s.past [] = some s.items ∧ (replay s.future s.items).isSome

/-- The states a List can be in: a new list, and any state a call whose
@requires holds leads to from one of them. -/
inductive Reached : State → Prop
  | initial : Reached initial
  | step {s : State} (c : Call) : Reached s → Requires s c → Reached (step s c)

theorem reachable_step (s : State) (c : Call) (hs : Reachable s) (hr : Requires s c) : Reachable (step s c) := by
  obtain ⟨hp, hf⟩ := hs
  match c with
  | .undo =>
    rcases List.eq_nil_or_concat s.past with h | ⟨ps, op, h⟩
    · simp_all [step, replay, unapply, Reachable]
    · rw [h, List.concat_eq_append, replay_append] at hp
      obtain ⟨prev, hprev, hrest⟩ := Option.bind_eq_some_iff.mp hp
      by_cases hv : valid prev op
      · simp [replay, hv] at hrest
        refine ⟨?_, ?_⟩
        · simp [step, h, ← hrest, unapply_apply _ _ hv, hprev]
        · rw [← hrest] at hf
          simp [step, h, ← hrest, unapply_apply _ _ hv, replay, hv, hf]
      · simp [replay, hv] at hrest
  | .redo =>
    cases hfut : s.future with
    | nil => simp_all [step, apply, Reachable, replay]
    | cons op fs =>
      rw [hfut] at hf
      by_cases hv : valid s.items op
      · simp [replay, hv] at hf
        refine ⟨?_, ?_⟩
        · simp [step, hfut, replay_append, hp, replay, hv]
        · simp [step, hfut, hf]
      · simp [replay, hv] at hf
  | .add i t | .remove i | .replace i t =>
    obtain ⟨hv, hi, hpast, hfuture⟩ := edit_records s _ _ rfl hr
    refine ⟨?_, ?_⟩
    · rw [hpast, replay_append, hp, hi]; simp [replay, hv]
    · simp [hfuture, replay]

theorem reached_reachable (s : State) (h : Reached s) : Reachable s := by
  induction h with
  | initial => simp [Reachable, initial, replay]
  | step c _ hr ih => exact reachable_step _ c ih hr

/-! ## Undo then redo, and redo then undo, restore the state -/

theorem undo_then_redo (s : State) (hs : Reachable s) (h : s.past ≠ []) :
    step (step s .undo) .redo = s := by
  obtain ⟨hp, _⟩ := hs
  obtain ⟨ps, op, hpast⟩ := (List.eq_nil_or_concat s.past).resolve_left h
  rw [hpast, List.concat_eq_append, replay_append] at hp
  obtain ⟨prev, hprev, hrest⟩ := Option.bind_eq_some_iff.mp hp
  by_cases hv : valid prev op
  · simp [replay, hv] at hrest
    obtain ⟨items, past, future⟩ := s
    simp at hpast
    subst hpast hrest
    simp [step, unapply_apply _ _ hv]
  · simp [replay, hv] at hrest

theorem redo_then_undo (s : State) (hs : Reachable s) (h : s.future ≠ []) :
    step (step s .redo) .undo = s := by
  obtain ⟨_, hf⟩ := hs
  obtain ⟨items, past, future⟩ := s
  cases future with
  | nil => simp at h
  | cons op fs =>
    by_cases hv : valid items op
    · simp [step, unapply_apply _ _ hv]
    · simp [replay, hv] at hf

/-! ## The brief's sentences

"Every change can be undone, in reverse order, back to the empty list":
from any state a List can be in, undoing as many times as there are
changes in past leaves no items and nothing in past. "In reverse order"
is the undoes rule itself: each undo reverses the last op in past. -/

def undos : Nat → State → State
  | 0, s => s
  | n + 1, s => undos n (step s .undo)

theorem undo_all (n : Nat) (s : State) (hs : Reachable s) (hn : s.past.length = n) :
    (undos n s).items = [] ∧ (undos n s).past = [] := by
  induction n generalizing s with
  | zero =>
    have hp : s.past = [] := List.eq_nil_of_length_eq_zero hn
    obtain ⟨hr, _⟩ := hs
    simp [hp, replay] at hr
    simp [undos, hp, hr]
  | succ n ih =>
    apply ih
    · exact reachable_step s .undo hs trivial
    · simp [step, hn]

theorem back_to_empty (s : State) (h : Reached s) :
    (undos s.past.length s).items = [] :=
  (undo_all _ s (reached_reachable s h) rfl).1

/-- "Anything undone can be redone until the user makes a new change":
redo restores what undo changed (undo_then_redo), and an edit leaves
nothing to redo. -/
theorem change_ends_redo (s s' : State) (c : Call) (op : Op) (hc : recorded s c = some op) (h : Ensures s c s') :
    s'.future = [] := by
  cases c <;> simp [recorded] at hc <;> simp_all [Ensures]

/-! ## Forbidden scenarios (scenarios.ts)

Each starts from a new list, which List.empty (@initially) fixes, and
each call's state is then fixed by `determined`. -/

/-- undo-wrong-order: after add(0, "milk"), add(1, "eggs") and undo, the
items aren't ["eggs"]. -/
theorem undo_wrong_order (s1 s2 s3 : State)
    (h1 : Ensures initial (.add 0 "milk") s1) (h2 : Ensures s1 (.add 1 "eggs") s2) (h3 : Ensures s2 .undo s3) :
    s3.items ≠ ["eggs"] := by
  rw [determined _ _ _ h1] at h2
  rw [determined _ _ _ h2] at h3
  rw [determined _ _ _ h3]
  decide

/-- redo-survives-change: after add(0, "milk"), undo and add(0, "eggs"),
there is nothing to redo (canRedo is false). -/
theorem redo_survives_change (s1 s2 s3 : State)
    (h1 : Ensures initial (.add 0 "milk") s1) (h2 : Ensures s1 .undo s2) (h3 : Ensures s2 (.add 0 "eggs") s3) :
    s3.future = [] := by
  rw [determined _ _ _ h1] at h2
  rw [determined _ _ _ h2] at h3
  rw [determined _ _ _ h3]
  decide
