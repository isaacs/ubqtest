# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and D50.
The answer to Q12 is D57. The answer to Q13 is D58. The answer
to Q14 is D61. The answers to Q15, Q16, Q18, and Q20 are D60. The answer to Q19
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

Q21 to Q26 come from `19-sonnet-feedback-0.0.16.md`: a conversion
of 167 vitest files of sentry-javascript `packages/core` by eight
agents on a smaller model. "N of 8" is the count of agents that
hit the problem.

Q27 to Q35 come from the same report. They are the points that
D78 to D86 did not decide.

## Q35. The format of converted code (6 of 8)

`ubq convert` keeps the code correct, not its format. It prints
the command of the formatter of the project in a note. Six agents
ran the formatter by hand, and one did not see the note.

Options:

1. No change.
2. The command runs the formatter of the project on the files
   that it changed, and says so. `--no-format` stops it.
3. The note becomes the last line of the output.

The agent would pick 2 without the option: one way. The formatter
is already a dependency of the project, and the agent runs it in
each case.
