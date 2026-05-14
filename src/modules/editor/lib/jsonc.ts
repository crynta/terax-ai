import type { StreamParser, StringStream } from "@codemirror/language";

type JsoncState = {
  inBlockComment: boolean;
};

function readString(stream: StringStream) {
  let escaped = false;
  stream.next();

  while (!stream.eol()) {
    const ch = stream.next();
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      break;
    }
  }
}

function skipInlineWhitespaceAndComments(line: string, pos: number): number {
  for (;;) {
    while (pos < line.length && /\s/.test(line[pos]!)) pos += 1;

    if (line.startsWith("//", pos)) return line.length;

    if (line.startsWith("/*", pos)) {
      const end = line.indexOf("*/", pos + 2);
      if (end === -1) return line.length;
      pos = end + 2;
      continue;
    }

    return pos;
  }
}

function isPropertyName(stream: StringStream): boolean {
  const pos = skipInlineWhitespaceAndComments(stream.string, stream.pos);
  return stream.string[pos] === ":";
}

export const jsonc: StreamParser<JsoncState> = {
  name: "jsonc",

  startState() {
    return { inBlockComment: false };
  },

  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match("/*")) {
      if (stream.skipTo("*/")) {
        stream.pos += 2;
      } else {
        state.inBlockComment = true;
        stream.skipToEnd();
      }
      return "comment";
    }

    const ch = stream.peek();

    if (ch === '"') {
      readString(stream);
      return isPropertyName(stream) ? "propertyName" : "string";
    }

    if (stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)) {
      return "number";
    }

    if (stream.match("true") || stream.match("false")) return "bool";
    if (stream.match("null")) return "keyword";

    if (stream.eat(/[{}\[\]:,]/)) return "punctuation";

    stream.next();
    return null;
  },

  languageData: {
    closeBrackets: { brackets: ["[", "{", '"'] },
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    indentOnInput: /^\s*[\}\]]$/,
  },
};
