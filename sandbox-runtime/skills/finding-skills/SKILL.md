---
name: finding-skills
description: Discover which Skills are installed and pick the right one for a task. Use at the START of a task to check whether an existing Skill already covers it, and whenever the user asks "what skills do I have", "what can you do", "is there a skill for X", or "list/find skills". Lists each Skill's name and description so the best match can be chosen and used.
---

# Finding the right Skill

Before solving a task from scratch, check whether an installed Skill already covers it.
The block below enumerates the Skills available in this sandbox (personal + project) with
their descriptions. If it shows a raw command instead of a list, run it yourself with the
Bash tool to get the same output.

## Available Skills

```!
for base in "$HOME/.claude/skills" "$PWD/.claude/skills"; do
  [ -d "$base" ] || continue
  echo "## $base"
  for d in "$base"/*/; do
    [ -f "${d}SKILL.md" ] || continue
    name="$(basename "$d")"
    desc="$(sed -n 's/^description:[[:space:]]*//p' "${d}SKILL.md" | head -1)"
    printf -- '- %s — %s\n' "$name" "${desc:-(no description)}"
  done
done
```

## How to use the list

1. Read each Skill's description and decide whether one fits the current task.
2. If one fits, use it instead of reinventing its steps — invoke it with `/<skill-name>`
   in an interactive session, or (in headless mode) read that Skill's `SKILL.md` and
   follow it.
3. If the user asked what you can do, present the list above (name + description).
4. If nothing fits, say so in one line and continue normally — never force a Skill.

The descriptions above are the source of truth for when each Skill applies. Prefer an
existing Skill over solving the same problem by hand.
