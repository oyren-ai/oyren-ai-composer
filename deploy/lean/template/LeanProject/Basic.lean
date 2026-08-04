/- Welcome! Put your cursor anywhere in a proof and the Lean Infoview (right panel)
   shows the goal state at that exact point. Ask the agent in the chat panel to
   help finish a proof — it edits these same files. -/

theorem add_comm_example (a b : Nat) : a + b = b + a := by
  exact Nat.add_comm a b

/-- An exercise left open on purpose: replace `sorry` with a proof (or ask the agent to). -/
theorem succ_pred (n : Nat) (h : n ≠ 0) : n.pred.succ = n := by
  sorry

#eval "Lean is running: " ++ toString (1 + 1)