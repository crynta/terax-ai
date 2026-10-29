import { describe, expect, it } from "vitest";
import { shellWordAt } from "./shellWord";

for (const windows of [false, true]) {
  describe(windows ? "PowerShell words" : "POSIX words", () => {
    it.each([
      ["cd src/te", "src/te"],
      ["cat 'a b' c", "c"],
      ['cat "a b" c', "c"],
      ["cd 'My Fol", "'My Fol"],
      ["cd 'My Folder/sub", "'My Folder/sub"],
      ["cd 'My Folder'/su", "'My Folder'/su"],
      ["echo hi; cd 'My F", "'My F"],
      ["ls 'a'|'b c", "'b c"],
      ["cat café/a,b.txt", "café/a,b.txt"],
      ["cd C:/work", "C:/work"],
      ["cd ", ""],
      ["cat 'line\nbreak", "'line\nbreak"],
    ])("finds the complete argument in %s", (line, word) => {
      expect(shellWordAt(line, line.length, windows)).toEqual({
        start: line.length - word.length,
        end: line.length,
        text: word,
      });
    });

    it("includes the closing quote and suffix when the cursor is inside a word", () => {
      const line = 'cat "My Folder/notes" next';
      expect(shellWordAt(line, 7, windows)).toEqual({
        start: 4,
        end: 21,
        text: '"My',
      });
    });

    it("does not truncate a long path in the middle of a quote", () => {
      const token = `'${"a".repeat(300)} folder'/sub`;
      const line = `cd ${token}`;
      expect(shellWordAt(line, line.length, windows).text).toBe(token);
    });
  });
}

it.each(["My\\ Fol", "a\\\\b", "My\\ Folder/ne", "a\\;b", 'a\\"b'])(
  "keeps POSIX escapes in %s",
  (token) => {
    expect(shellWordAt(`cd ${token}`, token.length + 3, false).text).toBe(
      token,
    );
  },
);
it("treats Windows backslashes as separators, not escapes", () => {
  expect(shellWordAt("cat dir\\ next", 13, true).text).toBe("next");
});
it("keeps PowerShell escaped spaces and doubled quotes together", () => {
  for (const token of [
    "My` Folder",
    "'it''s here'",
    "‘it’’s here’",
    '"a"" b"',
  ]) {
    expect(shellWordAt(`cat ${token}`, token.length + 4, true).text).toBe(
      token,
    );
  }
});
