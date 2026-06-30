---
name: codex-sdd-loop:status
description: Restore Codex SDD Loop context and show active change, gates, next action, pending hooks, and archives.
---

# OpenSpec Status

## Context
Status is the recovery entry point. Use it when the user asks what is active,
what is blocked, or how to resume a Codex SDD Loop workflow.

## Workflow
1. Call `openspec_get_status`.
2. Call `openspec_get_next_actions`.
3. If the next action mentions a hook point, call `openspec_get_pending_hooks`.
4. Summarize only:
   - active change ID and preset
   - current phase
   - gate state
   - next action
   - blocking hooks or missing artifacts

## Output
Give a short status update and the next concrete command or action. Do not
create or modify artifacts from this skill.
