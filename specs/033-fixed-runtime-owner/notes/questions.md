# Questions

## Q1

- Question: Should explicit owner transfer live under `stack` or under a new
  dedicated command family?
- Impact: CLI surface size, discoverability, and operational semantics.
- Decision needed: Current plan chooses `stack takeover --channel <stable|dev>`
  as the only mutation surface unless review finds a stronger alternative.

## Q2

- Question: Should isolated dev ports be deterministic from repo identity, or
  fully explicit by flags only?
- Impact: default collision avoidance and reproducibility for local testing.
- Decision needed: Current plan chooses deterministic isolated ports derived
  from worktree identity.

## Q3

- Question: Under what exact trusted conditions may `doctor --fix` stop a live
  mismatched owner?
- Impact: safety boundary for automatic repair.
- Decision needed: Current plan allows this only when the fixed-owner claim is
  present, live owner metadata is trusted, and the claimed target is
  restartable.

## Q4

- Question: Where should the canonical fixed-owner claim live?
- Impact: bootstrap order for source worktrees, doctor, and packed install.
- Decision needed: Current plan chooses a control-plane path independent of any
  individual runtime root.

## Q5

- Question: How does a source-side reclaim reliably relaunch stable?
- Impact: without this, `stack takeover --channel stable` can accidentally
  restart source code again.
- Decision needed: Current plan requires `launcher_ref` / owner-launcher
  resolution as a first-class contract.
