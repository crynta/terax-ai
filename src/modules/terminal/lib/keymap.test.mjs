import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function loadKeymapFunction(name) {
  const source = fs.readFileSync(
    new URL("./keymap.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(
    new RegExp(
      `export function ${name}\\(event: TerminalKeyEvent\\): string \\| null \\{([\\s\\S]*?)\\n\\}`,
    ),
  );
  if (!match) throw new Error(`${name} export not found`);
  return new Function(
    `return function ${name}(event) {${match[1]}\n}`,
  )();
}

test("maps Option+Left to readline word-left", () => {
  const terminalWordNavigationSequence = loadKeymapFunction(
    "terminalWordNavigationSequence",
  );

  assert.equal(
    terminalWordNavigationSequence({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowLeft",
      code: "ArrowLeft",
    }),
    "\x1bb",
  );
});

test("maps Option+Right to readline word-right", () => {
  const terminalWordNavigationSequence = loadKeymapFunction(
    "terminalWordNavigationSequence",
  );

  assert.equal(
    terminalWordNavigationSequence({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowRight",
      code: "ArrowRight",
    }),
    "\x1bf",
  );
});

test("does not remap plain arrows", () => {
  const terminalWordNavigationSequence = loadKeymapFunction(
    "terminalWordNavigationSequence",
  );

  assert.equal(
    terminalWordNavigationSequence({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowLeft",
      code: "ArrowLeft",
    }),
    null,
  );
});

test("maps Command+Left to readline line-start", () => {
  const terminalLineNavigationSequence = loadKeymapFunction(
    "terminalLineNavigationSequence",
  );

  assert.equal(
    terminalLineNavigationSequence({
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      key: "ArrowLeft",
      code: "ArrowLeft",
    }),
    "\x01",
  );
});

test("maps Command+Right to readline line-end", () => {
  const terminalLineNavigationSequence = loadKeymapFunction(
    "terminalLineNavigationSequence",
  );

  assert.equal(
    terminalLineNavigationSequence({
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      key: "ArrowRight",
      code: "ArrowRight",
    }),
    "\x05",
  );
});

test("does not remap Option+Command arrows as line navigation", () => {
  const terminalLineNavigationSequence = loadKeymapFunction(
    "terminalLineNavigationSequence",
  );

  assert.equal(
    terminalLineNavigationSequence({
      altKey: true,
      ctrlKey: false,
      metaKey: true,
      key: "ArrowRight",
      code: "ArrowRight",
    }),
    null,
  );
});
