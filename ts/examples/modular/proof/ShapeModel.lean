/-
Do ShapeMessageProcessor's rules (shapeModel.ts) determine its model?

The rules about what is present are kept, remove-listed, clear-known and
add-on-z, all over applied(this) (dataModel.vocab.ts). This file shows:
1. Those four don't: a model holding a shape no applied add made
   satisfies all of them (`rules_allow_a_stray_shape`).
2. With only-applied (every present shape's ID has an applied add), they
   do: any two models that satisfy them are equal, order included
   (`rules_determine_model`). only-applied was added to shapeModel.ts
   because of the first result.

Lean 4 core only. Each definition translates a rule or vocabulary function
by hand; its comment names the source.
-/

/-! ## Operations -/

/-- What a ShapeOp does. IDs and shapes are opaque tokens here: the rules
compare them only for equality (deepEqual on a shape is equality). -/
inductive Body where
  | add (id : Nat) (shape : Nat)
  | remove (ids : List Nat)
  | clear
deriving DecidableEq

/-- A ShapeOp with the Operation fields (dataModel.ts); seq is -1 while
pending. -/
structure SOp where
  body : Body
  clientId : String
  clientSeq : Int
  refSeq : Int
  seq : Int

def isAddWithId (id : Nat) (o : SOp) : Bool :=
  match o.body with
  | .add i _ => i == id
  | _ => false

/-- addOf (shapeModel.vocab.ts): the add among ops that made the shape id. -/
def addOf (ops : List SOp) (id : Nat) : Option SOp := ops.find? (isAddWithId id)

/-- knew (dataModel.vocab.ts). -/
def Knew (op other : SOp) : Prop :=
  (other.seq ≠ -1 ∧ other.seq ≤ op.refSeq) ∨
  (other.clientId = op.clientId ∧ other.clientSeq < op.clientSeq)

/-- removedBy (shapeModel.vocab.ts): some remove lists the add's shape, or
some clear knew the add. -/
def RemovedBy (ops : List SOp) (a : SOp) (id : Nat) : Prop :=
  ∃ o ∈ ops, (∃ ids, o.body = .remove ids ∧ id ∈ ids) ∨ (o.body = .clear ∧ Knew o a)

/-- compareOrder (shapeModel.vocab.ts) < 0: acknowledged adds by seq, below
pending ones by clientSeq. -/
def Before (a b : SOp) : Prop :=
  if a.seq ≠ -1 ∧ b.seq ≠ -1 then a.seq < b.seq
  else if (a.seq ≠ -1) ≠ (b.seq ≠ -1) then a.seq ≠ -1
  else a.clientSeq < b.clientSeq

theorem before_irrefl (a : SOp) : ¬ Before a a := by
  unfold Before
  by_cases h : a.seq ≠ -1 <;> simp [h]

theorem before_asymm (a b : SOp) : Before a b → ¬ Before b a := by
  unfold Before
  by_cases ha : a.seq = -1 <;> by_cases hb : b.seq = -1 <;> simp [ha, hb] <;> omega

/-! ## The model

A ShapeCollection, bottom to top, as (id, shape) pairs. this.model.get(id)
is the shape paired with id; the collection holds each id once, which
add-on-z below implies. -/

abbrev Model := List (Nat × Nat)

/-- ShapeMessageProcessor.kept:
applied(this).filter(isAdd).every((a) => removedBy(applied(this), a) || deepEqual(this.model.get(a.id), a.shape)) -/
def Kept (ops : List SOp) (m : Model) : Prop :=
  ∀ o ∈ ops, ∀ id s, o.body = .add id s → RemovedBy ops o id ∨ (id, s) ∈ m

/-- ShapeMessageProcessor.remove-listed:
applied(this).filter(isRemove).every((r) => r.ids.every((id) => this.model.get(id) === undefined)) -/
def RemoveListed (ops : List SOp) (m : Model) : Prop :=
  ∀ o ∈ ops, ∀ ids, o.body = .remove ids → ∀ id ∈ ids, ∀ s, (id, s) ∉ m

/-- ShapeMessageProcessor.clear-known:
applied(this).filter(isClear).every((c) => applied(this).filter(isAdd).every((a) => !knew(c, a) || this.model.get(a.id) === undefined)) -/
def ClearKnown (ops : List SOp) (m : Model) : Prop :=
  ∀ o ∈ ops, o.body = .clear → ∀ a ∈ ops, ∀ id s, a.body = .add id s → Knew o a → ∀ s', (id, s') ∉ m

/-- ShapeMessageProcessor.add-on-z:
isStrictlySorted(ids(this.model), (a, b) => compareShapes(applied(this), a, b))
compareShapes (shapeModel.vocab.ts) is NaN, ordering nothing, unless both
ids have adds. -/
def InOrder (ops : List SOp) (p q : Nat × Nat) : Prop :=
  ∃ a b, addOf ops p.1 = some a ∧ addOf ops q.1 = some b ∧ Before a b

def AddOnZ (ops : List SOp) (m : Model) : Prop := m.Pairwise (InOrder ops)

/-- ShapeMessageProcessor.only-applied (added 2026-11-18, after this proof):
ids(this.model).every((id) => addOf(applied(this), id) !== undefined) -/
def OnlyApplied (ops : List SOp) (m : Model) : Prop :=
  ∀ p ∈ m, ∃ a, addOf ops p.1 = some a

def Rules (ops : List SOp) (m : Model) : Prop :=
  Kept ops m ∧ RemoveListed ops m ∧ ClearKnown ops m ∧ AddOnZ ops m

/-! ## 1. As written, the rules allow a stray shape -/

theorem rules_allow_a_stray_shape : Rules [] [(0, 0)] ∧ Rules [] [] := by
  refine ⟨⟨?_, ?_, ?_, ?_⟩, ⟨?_, ?_, ?_, ?_⟩⟩ <;>
    simp [Kept, RemoveListed, ClearKnown, AddOnZ]

/-! ## 2. With only-applied, the rules determine the model -/

theorem inOrder_irrefl (ops : List SOp) (p : Nat × Nat) : ¬ InOrder ops p p := by
  rintro ⟨a, b, ha, hb, h⟩
  rw [ha] at hb
  cases hb
  exact before_irrefl a h

theorem inOrder_asymm (ops : List SOp) (p q : Nat × Nat) :
    InOrder ops p q → ¬ InOrder ops q p := by
  rintro ⟨a, b, ha, hb, h⟩ ⟨b', a', hb', ha', h'⟩
  rw [ha] at ha'
  rw [hb] at hb'
  cases ha'
  cases hb'
  exact before_asymm a b h h'

/-- Two elements of a pairwise-related list are equal or related one way. -/
theorem pairwise_mem_cases {α} {R : α → α → Prop} :
    ∀ {l : List α}, l.Pairwise R → ∀ {a b}, a ∈ l → b ∈ l → a = b ∨ R a b ∨ R b a
  | [], _, _, _, ha, _ => by simp at ha
  | x :: t, hl, a, b, ha, hb => by
    rw [List.pairwise_cons] at hl
    rcases List.mem_cons.mp ha with ha' | ha' <;> rcases List.mem_cons.mp hb with hb' | hb'
    · exact Or.inl (ha'.trans hb'.symm)
    · subst ha'; exact Or.inr (Or.inl (hl.1 b hb'))
    · subst hb'; exact Or.inr (Or.inr (hl.1 a ha'))
    · exact pairwise_mem_cases hl.2 ha' hb'

/-- Two lists with the same members, each strictly ordered by an
irreflexive, asymmetric relation, are equal. -/
theorem eq_of_mem_iff_of_pairwise {α} {R : α → α → Prop}
    (irr : ∀ a, ¬ R a a) (asymm : ∀ a b, R a b → ¬ R b a) :
    ∀ {l₁ l₂ : List α}, l₁.Pairwise R → l₂.Pairwise R → (∀ x, x ∈ l₁ ↔ x ∈ l₂) → l₁ = l₂
  | [], [], _, _, _ => rfl
  | [], b :: _, _, _, h => by simpa using (h b).mpr (by simp)
  | a :: _, [], _, _, h => by simpa using (h a).mp (by simp)
  | a :: t₁, b :: t₂, h₁, h₂, h => by
    rw [List.pairwise_cons] at h₁ h₂
    have hab : a = b := by
      rcases List.mem_cons.mp ((h a).mp (by simp)) with hab | ha2
      · exact hab
      rcases List.mem_cons.mp ((h b).mpr (by simp)) with hba | hb1
      · exact hba.symm
      exact absurd (h₁.1 b hb1) (asymm b a (h₂.1 a ha2))
    subst hab
    have ht : ∀ x, x ∈ t₁ ↔ x ∈ t₂ := by
      intro x
      constructor
      · intro hx
        rcases List.mem_cons.mp ((h x).mp (List.mem_cons_of_mem a hx)) with rfl | hx2
        · exact absurd (h₁.1 x hx) (irr x)
        · exact hx2
      · intro hx
        rcases List.mem_cons.mp ((h x).mpr (List.mem_cons_of_mem a hx)) with rfl | hx1
        · exact absurd (h₂.1 x hx) (irr x)
        · exact hx1
    rw [eq_of_mem_iff_of_pairwise irr asymm h₁.2 h₂.2 ht]

theorem addOf_spec {ops : List SOp} {id : Nat} {a : SOp} (h : addOf ops id = some a) :
    a ∈ ops ∧ ∃ s, a.body = .add id s := by
  refine ⟨List.mem_of_find?_eq_some h, ?_⟩
  have := List.find?_some h
  unfold isAddWithId at this
  split at this
  · rename_i i s hb
    exact ⟨s, by simp at this; rw [hb, this]⟩
  · simp at this

/-- In a model that satisfies add-on-z, an id is present with one shape. -/
theorem present_unique {ops : List SOp} {m : Model} (hz : AddOnZ ops m)
    {p q : Nat × Nat} (hp : p ∈ m) (hq : q ∈ m) (hid : p.1 = q.1) : p = q := by
  rcases pairwise_mem_cases hz hp hq with h | ⟨a, b, ha, hb, hab⟩ | ⟨a, b, ha, hb, hab⟩
  · exact h
  · rw [← hid, ha] at hb; cases hb; exact absurd hab (before_irrefl a)
  · rw [hid, ha] at hb; cases hb; exact absurd hab (before_irrefl a)

/-- A present shape in a model that satisfies the rules is its add's
shape, and that add was not removed. -/
theorem present_is_kept {ops : List SOp} {m : Model} (hr : Rules ops m) (ho : OnlyApplied ops m)
    {p : Nat × Nat} (hp : p ∈ m) :
    ∃ a s, addOf ops p.1 = some a ∧ a.body = .add p.1 s ∧ ¬ RemovedBy ops a p.1 ∧ p.2 = s := by
  obtain ⟨hk, hl, hc, hz⟩ := hr
  obtain ⟨a, ha⟩ := ho p hp
  obtain ⟨ha_mem, s, hs⟩ := addOf_spec ha
  have hnr : ¬ RemovedBy ops a p.1 := by
    rintro ⟨o, ho_mem, ⟨ids, hids, hin⟩ | ⟨hclr, hknew⟩⟩
    · exact hl o ho_mem ids hids p.1 hin p.2 hp
    · exact hc o ho_mem hclr a ha_mem p.1 s hs hknew p.2 hp
  refine ⟨a, s, ha, hs, hnr, ?_⟩
  rcases hk a ha_mem p.1 s hs with h | h
  · exact absurd h hnr
  · have := present_unique hz hp h rfl
    rw [this]

theorem rules_determine_model (ops : List SOp) (m₁ m₂ : Model)
    (h₁ : Rules ops m₁) (o₁ : OnlyApplied ops m₁)
    (h₂ : Rules ops m₂) (o₂ : OnlyApplied ops m₂) : m₁ = m₂ := by
  have moves : ∀ {m m' : Model}, Rules ops m → OnlyApplied ops m → Rules ops m' →
      ∀ p ∈ m, p ∈ m' := by
    intro m m' hr ho hr' p hp
    obtain ⟨a, s, ha, hs, hnr, hps⟩ := present_is_kept hr ho hp
    rcases hr'.1 a (addOf_spec ha).1 p.1 s hs with h | h
    · exact absurd h hnr
    · rw [← hps] at h; exact h
  exact eq_of_mem_iff_of_pairwise (inOrder_irrefl ops) (inOrder_asymm ops) h₁.2.2.2 h₂.2.2.2
    (fun p => ⟨moves h₁ o₁ h₂ p, moves h₂ o₂ h₁ p⟩)
