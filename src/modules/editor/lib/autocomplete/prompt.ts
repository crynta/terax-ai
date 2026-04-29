export type CompletionRequest = {
  prefix: string;
  suffix: string;
  language: string | null;
  filename: string | null;
};

const MAX_PREFIX = 2000;
const MAX_SUFFIX = 1000;

export function trimContext(prefix: string, suffix: string) {
  const p =
    prefix.length > MAX_PREFIX
      ? prefix.slice(prefix.length - MAX_PREFIX)
      : prefix;
  const s = suffix.length > MAX_SUFFIX ? suffix.slice(0, MAX_SUFFIX) : suffix;
  return { prefix: p, suffix: s };
}

export const COMPLETION_SYSTEM_PROMPT = `You perform fill-in-the-middle code completion.

You receive PREFIX (code before the cursor) and SUFFIX (code after the cursor). Your output is inserted EXACTLY at the cursor position. PREFIX + your_output + SUFFIX must form valid, syntactically-correct code.

Output the next chunk of code you can predict with high confidence. Stop when the next decision becomes genuinely ambiguous. A good chunk is usually:
- The remaining characters of a partially-typed token, OR
- A full line (statement, signature, expression), OR
- A short block (2–6 lines) when its closing delimiter is already in SUFFIX.

Hard rules:
1. NEVER repeat any text already present in PREFIX or SUFFIX.
2. NEVER write code that belongs after SUFFIX.
3. Match surrounding indentation, quoting, and naming conventions exactly.
4. Output empty string when no confident completion exists — never guess.
5. Output format: raw insertion text only. No markdown fences. No commentary. No "Here is".

Examples:

PREFIX: "#[te"
SUFFIX: "]"
OUTPUT: "st"

PREFIX: "fn binary_search"
SUFFIX: ""
OUTPUT: "<T: Ord>(arr: &[T], target: &T) -> Option<usize> {"

PREFIX: "for (let i = 0; i < arr.length; i"
SUFFIX: ") {\\n"
OUTPUT: "++"

PREFIX: "const sum = (a, b) => "
SUFFIX: ";"
OUTPUT: "a + b"

PREFIX: "function fetchUser(id: string) {\\n  "
SUFFIX: "\\n}"
OUTPUT: "return fetch(\`/api/users/\${id}\`).then(r => r.json());"`;

export function buildUserPrompt(req: CompletionRequest): string {
  const { prefix, suffix } = trimContext(req.prefix, req.suffix);
  const meta: string[] = [];
  if (req.filename) meta.push(`File: ${req.filename}`);
  if (req.language) meta.push(`Language: ${req.language}`);
  const metaBlock = meta.length ? meta.join("\n") + "\n\n" : "";

  return `${metaBlock}PREFIX:
<<<
${prefix}
>>>

SUFFIX:
<<<
${suffix}
>>>

Output the text to insert at the cursor.`;
}
