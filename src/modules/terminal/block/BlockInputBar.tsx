import { detectMonoFontFamily } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { BlockMode } from "./lib/modeMachine";

export type BlockInputBarHandle = { focus: () => void };

type Props = {
  mode: BlockMode;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
};

function autoSize(el: HTMLTextAreaElement): void {
  el.style.height = "0px";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

export const BlockInputBar = forwardRef<BlockInputBarHandle, Props>(
  function BlockInputBar({ mode, onSubmit, onInterrupt }, ref) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const history = useRef<string[]>([]);
    const histIdx = useRef(-1);
    const atPrompt = mode === "prompt";

    useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);

    const fontFamilyPref = usePreferencesStore((p) => p.terminalFontFamily);
    const fontSize = usePreferencesStore((p) => p.terminalFontSize);
    const fontFamily = fontFamilyPref || detectMonoFontFamily();

    useEffect(() => {
      if (atPrompt) taRef.current?.focus();
    }, [atPrompt]);

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const value = ta.value;
        if (value.trim()) history.current.push(value);
        histIdx.current = -1;
        ta.value = "";
        autoSize(ta);
        onSubmit(value);
        return;
      }
      if (e.key === "c" && e.ctrlKey) {
        e.preventDefault();
        ta.value = "";
        autoSize(ta);
        onInterrupt();
        return;
      }
      const h = history.current;
      if (e.key === "ArrowUp" && ta.selectionStart === 0 && h.length > 0) {
        e.preventDefault();
        histIdx.current =
          histIdx.current < 0 ? h.length - 1 : Math.max(0, histIdx.current - 1);
        ta.value = h[histIdx.current] ?? "";
        autoSize(ta);
        return;
      }
      if (e.key === "ArrowDown" && histIdx.current >= 0) {
        e.preventDefault();
        histIdx.current += 1;
        if (histIdx.current >= h.length) {
          histIdx.current = -1;
          ta.value = "";
        } else {
          ta.value = h[histIdx.current] ?? "";
        }
        autoSize(ta);
      }
    };

    return (
      <div
        className={cn(
          "flex items-start gap-2 border-b border-border/50 px-4 py-2.5",
          !atPrompt && "opacity-45",
        )}
      >
        <span
          className="select-none pt-px text-primary/80"
          style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5 }}
        >
          ❯
        </span>
        <textarea
          ref={taRef}
          rows={1}
          disabled={!atPrompt}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder={atPrompt ? "Run a command" : "running…"}
          onKeyDown={onKeyDown}
          onInput={(e) => autoSize(e.currentTarget)}
          className="flex-1 resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground/40"
          style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5 }}
        />
      </div>
    );
  },
);
