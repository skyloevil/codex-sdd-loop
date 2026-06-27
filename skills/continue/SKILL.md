---
name: openspec-assistant:continue
description: Resume the active OpenSpec Assistant workflow by selecting the next action from the state machine.
---

# OpenSpec Continue

## Context
Continue is the high-level entry point for a smooth Codex App workflow. It
uses the state machine to decide what should happen next, instead of requiring
the user to remember propose/plan/implement/validate/archive commands.

## Workflow
1. Call `openspec_get_next_actions`.
2. Follow the first action unless it requires human confirmation.
3. If the action has `mode: review` or `mode: manual`, summarize the artifact
   or risk and ask for confirmation before calling `openspec_set_gate`.
4. If the action is `implement_next_task`, read `tasks` with
   `openspec_read_artifact`, implement the next incomplete task, then call
   `openspec_update_task`.
5. If the action is `validate`, call `openspec_validate`; fix drift or ask for
   confirmation when clean.
6. If the action is `archive`, call `openspec_get_pending_hooks` for
   `pre_archive`; required hooks must pass before `openspec_archive_change`.

## Human Gates
Confirm at scope, design, validation, archive, and before destructive work:
file deletion, public API changes, database schema changes, broad refactors, or
external-system writes.
