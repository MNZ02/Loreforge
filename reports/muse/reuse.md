# Blackboard code provenance (Muse core)

Blackboard reference: `/Users/mnz/dev/messageboard`, HEAD
`5f4f56fc8a2775aba3fff0b554f8f929c99e8d9f` (per PLAN.md).

No Blackboard code was copied into this project. The core implementation
(`src/core/**`, `src/storage/**`, `src/evidence/**`) was written fresh
against `docs/implementation/CONTRACT.md`:

- Attempt/lease handling, receipt hashing, and Git observation were designed
  directly from the frozen contract's wording (fixed 2h lease, canonical
  request hash with sorted keys, read-only argument-array Git calls).
- No Blackboard file was read with `git show` or imported during this work;
  no worktree, process-adapter, cloud-database, UI, or scheduler logic was
  brought over. There is nothing to attribute, so no file/revision/adaptation
  rows follow.

Stated explicitly for the final report: no code copied.
