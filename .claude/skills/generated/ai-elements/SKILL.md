---
name: ai-elements
description: "Skill for the Ai-elements area of terax-ai. 80 symbols across 14 files."
---

# Ai-elements

80 symbols | 14 files | Cohesion: 75%

## When to Use

- Working with code in `src/`
- Understanding how MessageResponse, useReasoning, Reasoning work
- Modifying ai-elements-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/components/ai-elements/tool.tsx` | ToolImpl, ToolInput, ToolOutput, CodeBlockMini, deriveSummary (+8) |
| `src/components/ai-elements/context.tsx` | useContextValue, ContextIcon, ContextTrigger, TokensWithCost, ContextInputUsage (+6) |
| `src/components/ai-elements/chat-code.tsx` | FinalizedCodeBlock, HighlightedPre, shellPrompt, normalizeLangLabel, ChatCodeBlock (+5) |
| `src/modules/ai/components/AiChat.tsx` | basename, ReadGroup, RenderedPart, AiChatView, patchAgentMeta (+4) |
| `src/components/ai-elements/message.tsx` | MessageResponse, useMessageBranch, MessageBranchContent, MessageBranchPrevious, MessageBranchNext (+3) |
| `src/components/ai-elements/conversation.tsx` | Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton, getMessageText (+3) |
| `src/components/ai-elements/chat-code-lezer.ts` | resolve, isHighlightable, getLezer, getStream, highlightStream (+2) |
| `src/components/ai-elements/reasoning.tsx` | useReasoning, Reasoning, ReasoningTrigger, ReasoningContent |
| `src/components/ui/collapsible.tsx` | Collapsible, CollapsibleTrigger, CollapsibleContent |
| `src/components/ui/hover-card.tsx` | HoverCardTrigger, HoverCard |

## Entry Points

Start here when exploring this area:

- **`MessageResponse`** (Function) — `src/components/ai-elements/message.tsx:325`
- **`useReasoning`** (Function) — `src/components/ai-elements/reasoning.tsx:33`
- **`Reasoning`** (Function) — `src/components/ai-elements/reasoning.tsx:52`
- **`ReasoningTrigger`** (Function) — `src/components/ai-elements/reasoning.tsx:161`
- **`ReasoningContent`** (Function) — `src/components/ai-elements/reasoning.tsx:203`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `MessageResponse` | Function | `src/components/ai-elements/message.tsx` | 325 |
| `useReasoning` | Function | `src/components/ai-elements/reasoning.tsx` | 33 |
| `Reasoning` | Function | `src/components/ai-elements/reasoning.tsx` | 52 |
| `ReasoningTrigger` | Function | `src/components/ai-elements/reasoning.tsx` | 161 |
| `ReasoningContent` | Function | `src/components/ai-elements/reasoning.tsx` | 203 |
| `isHighlightable` | Function | `src/components/ai-elements/chat-code-lezer.ts` | 166 |
| `highlight` | Function | `src/components/ai-elements/chat-code-lezer.ts` | 292 |
| `ChatCodeBlock` | Function | `src/components/ai-elements/chat-code.tsx` | 60 |
| `MarkdownCode` | Function | `src/components/ai-elements/markdown-code.tsx` | 11 |
| `ContextTrigger` | Function | `src/components/ai-elements/context.tsx` | 106 |
| `ContextInputUsage` | Function | `src/components/ai-elements/context.tsx` | 252 |
| `ContextOutputUsage` | Function | `src/components/ai-elements/context.tsx` | 292 |
| `ContextReasoningUsage` | Function | `src/components/ai-elements/context.tsx` | 332 |
| `ContextCacheUsage` | Function | `src/components/ai-elements/context.tsx` | 372 |
| `Conversation` | Function | `src/components/ai-elements/conversation.tsx` | 13 |
| `ConversationContent` | Function | `src/components/ai-elements/conversation.tsx` | 27 |
| `ConversationEmptyState` | Function | `src/components/ai-elements/conversation.tsx` | 43 |
| `ConversationScrollButton` | Function | `src/components/ai-elements/conversation.tsx` | 74 |
| `AiChatView` | Function | `src/modules/ai/components/AiChat.tsx` | 180 |
| `patchAgentMeta` | Function | `src/modules/ai/components/AiChat.tsx` | 197 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 29 calls |
| Components | 3 calls |
| Ai | 2 calls |
| Theme | 1 calls |

## How to Explore

1. `gitnexus_context({name: "MessageResponse"})` — see callers and callees
2. `gitnexus_query({query: "ai-elements"})` — find related execution flows
3. Read key files listed above for implementation details
