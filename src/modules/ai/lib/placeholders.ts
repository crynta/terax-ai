const PLACEHOLDERS = [
  "Explain this error…",
  "Summarize the last command output",
  "Write a bash one-liner that…",
  "Refactor the selected code",
  "Generate a .gitignore for this project",
  "What does this stack trace mean?",
  "Draft a commit message for staged changes",
  "Find files larger than 50MB",
  "Convert this JSON to a TypeScript type",
  "Why is my build failing?",
];

export function pickPlaceholder(): string {
  return PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
}
