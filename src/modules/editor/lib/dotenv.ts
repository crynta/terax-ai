import type { StreamParser, StringStream } from "@codemirror/language";

type DotenvState = {
  mode: "start" | "afterExport" | "afterKey" | "value";
  quote: "'" | '"' | null;
  valueStarted: boolean;
  afterValueSpace: boolean;
};

function resetLine(state: DotenvState): void {
  state.mode = "start";
  state.quote = null;
  state.valueStarted = false;
  state.afterValueSpace = false;
}

function tokenVariable(stream: StringStream): string | null {
  if (stream.next() !== "$") return null;

  if (stream.eat("{")) {
    stream.eatWhile(/[A-Za-z0-9_]/);
    stream.eat("}");
    return "variableName.special";
  }

  if (!stream.eat(/[A-Za-z_]/)) return "operator";
  stream.eatWhile(/[A-Za-z0-9_]/);
  return "variableName.special";
}

function tokenQuotedValue(
  stream: StringStream,
  state: DotenvState,
): string | null {
  if (stream.peek() === state.quote) {
    stream.next();
    state.quote = null;
    state.mode = "value";
    return "string";
  }

  if (state.quote === '"' && stream.peek() === "$") {
    return tokenVariable(stream);
  }

  while (!stream.eol()) {
    const ch = stream.peek();
    if (ch === state.quote || (state.quote === '"' && ch === "$")) break;
    stream.next();
  }

  return "string";
}

export const dotenv: StreamParser<DotenvState> = {
  name: "dotenv",

  startState() {
    return {
      mode: "start",
      quote: null,
      valueStarted: false,
      afterValueSpace: false,
    };
  },

  token(stream, state) {
    if (stream.sol()) resetLine(state);
    if (stream.eol()) return null;

    if (state.quote) return tokenQuotedValue(stream, state);

    if (stream.eatSpace()) {
      if (state.mode === "value") {
        state.afterValueSpace = true;
      }
      return null;
    }

    if (state.mode !== "value" && stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    if (
      state.mode === "start" &&
      stream.match(/^export(?=\s+[A-Za-z_])/, true)
    ) {
      state.mode = "afterExport";
      return "keyword";
    }

    if (state.mode === "start" || state.mode === "afterExport") {
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/, true)) {
        state.mode = "afterKey";
        return "variableName.definition";
      }

      stream.skipToEnd();
      return "invalid";
    }

    if (state.mode === "afterKey") {
      if (stream.eat("=")) {
        state.mode = "value";
        return "operator";
      }

      stream.skipToEnd();
      return "invalid";
    }

    if (stream.peek() === "'" || stream.peek() === '"') {
      state.quote = stream.next() as "'" | '"';
      state.valueStarted = true;
      state.afterValueSpace = false;
      return "string";
    }

    if (stream.peek() === "$") {
      state.valueStarted = true;
      state.afterValueSpace = false;
      return tokenVariable(stream);
    }

    if (state.afterValueSpace && stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    while (!stream.eol()) {
      const ch = stream.peek();
      if (ch === "$" || /\s/.test(ch ?? "")) break;
      stream.next();
    }

    state.valueStarted = true;
    state.afterValueSpace = false;
    return "string";
  },

  languageData: {
    closeBrackets: { brackets: ["'", '"'] },
    commentTokens: { line: "#" },
  },
};
