# Notes for Claude

Read `docs/README.md` first. `docs/07-status.md` has the current
state and the checks to run before each commit.

## Commits

When you commit as Claude, add a `Co-Authored-By` line for the
person who drives the agent session, with the other
`Co-Authored-By` lines. It records which person worked with the
agent.

Use the name and the email address of that person. For the owner
of the repository, the line is:

```
Co-Authored-By: isaacs <i@izs.me>
```

If a different person drives the session, use that person's name
and address, not this line. If you do not know them, ask.
