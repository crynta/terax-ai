import { describe, expect, it } from "vitest";
import {
  CompletionItemKind,
  CompletionTriggerKind,
  DiagnosticSeverity,
  DocumentHighlightKind,
} from "./protocolShim";

describe("LSP protocol shim enum values", () => {
  it("keeps DiagnosticSeverity on the wire values", () => {
    expect(DiagnosticSeverity.Error).toBe(1);
    expect(DiagnosticSeverity.Warning).toBe(2);
    expect(DiagnosticSeverity.Information).toBe(3);
    expect(DiagnosticSeverity.Hint).toBe(4);
  });

  it("keeps CompletionTriggerKind on the wire values", () => {
    expect(CompletionTriggerKind.Invoked).toBe(1);
    expect(CompletionTriggerKind.TriggerCharacter).toBe(2);
    expect(CompletionTriggerKind.TriggerForIncompleteCompletions).toBe(3);
  });

  it("keeps DocumentHighlightKind on the wire values", () => {
    expect(DocumentHighlightKind.Text).toBe(1);
    expect(DocumentHighlightKind.Read).toBe(2);
    expect(DocumentHighlightKind.Write).toBe(3);
  });

  it("keeps representative CompletionItemKind entries on the wire values", () => {
    expect(CompletionItemKind.Text).toBe(1);
    expect(CompletionItemKind.Method).toBe(2);
    expect(CompletionItemKind.Function).toBe(3);
    expect(CompletionItemKind.Constructor).toBe(4);
    expect(CompletionItemKind.Field).toBe(5);
    expect(CompletionItemKind.Variable).toBe(6);
    expect(CompletionItemKind.Class).toBe(7);
    expect(CompletionItemKind.Interface).toBe(8);
    expect(CompletionItemKind.Module).toBe(9);
    expect(CompletionItemKind.Property).toBe(10);
    expect(CompletionItemKind.Unit).toBe(11);
    expect(CompletionItemKind.Value).toBe(12);
    expect(CompletionItemKind.Enum).toBe(13);
    expect(CompletionItemKind.Keyword).toBe(14);
    expect(CompletionItemKind.Snippet).toBe(15);
    expect(CompletionItemKind.Color).toBe(16);
    expect(CompletionItemKind.File).toBe(17);
    expect(CompletionItemKind.Reference).toBe(18);
    expect(CompletionItemKind.Folder).toBe(19);
    expect(CompletionItemKind.EnumMember).toBe(20);
    expect(CompletionItemKind.Constant).toBe(21);
    expect(CompletionItemKind.Struct).toBe(22);
    expect(CompletionItemKind.Event).toBe(23);
    expect(CompletionItemKind.Operator).toBe(24);
    expect(CompletionItemKind.TypeParameter).toBe(25);
  });
});
