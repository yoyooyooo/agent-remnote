# Resolved Questions

## Q1

- Question: Should explicit owner transfer live under `stack` or under a new
  dedicated command family?
- Impact: CLI surface size, discoverability, and operational semantics.
- Decision: `stack takeover --channel <stable|dev>` 保持为唯一 mutation surface。

## Q2

- Question: Should isolated dev ports be deterministic from repo identity, or
  fully explicit by flags only?
- Impact: default collision avoidance and reproducibility for local testing.
- Decision: isolated ports 仍由 worktree 派生，但当前实现具体以解析后的 `runtime_root` 作为最终 seed，避免同一 worktree 的并发测试互撞。

## Q3

- Question: Under what exact trusted conditions may `doctor --fix` stop a live
  mismatched owner?
- Impact: safety boundary for automatic repair.
- Decision: `doctor --fix` 只在 fixed-owner claim 存在、live owner trusted、且 claimed target 可执行时触发 deterministic realignment。

## Q4

- Question: Where should the canonical fixed-owner claim live?
- Impact: bootstrap order for source worktrees, doctor, and packed install.
- Decision: canonical fixed-owner claim 始终落在独立 control-plane 路径，不依赖单个 runtime root。

## Q5

- Question: How does a source-side reclaim reliably relaunch stable?
- Impact: without this, `stack takeover --channel stable` can accidentally
  restart source code again.
- Decision: reclaim stable 通过 first-class launcher 解析执行，当前支持显式 env 覆盖与 Volta shim fallback。
