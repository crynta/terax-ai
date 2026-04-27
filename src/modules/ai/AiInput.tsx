import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ArrowUp01Icon, Square01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { pickPlaceholder } from "./lib/placeholders";

export type AiInputHandle = {
  focus: () => void;
  setValue: (v: string) => void;
};

type Props = {
  onSubmit: (prompt: string) => void;
  onStop?: () => void;
  onClose?: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export const AiInput = forwardRef<AiInputHandle, Props>(function AiInput(
  { onSubmit, onStop, onClose, disabled, busy },
  ref,
) {
  const [value, setValue] = useState("");
  const placeholder = useMemo(() => pickPlaceholder(), []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue,
  }));

  const submit = () => {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-end gap-1.5 rounded-md px-1.5 py-1">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "Working…" : `e.g. ${placeholder}`}
          rows={1}
          disabled={disabled}
          className={cn(
            "min-h-8 flex-1 resize-none border-transparent bg-transparent px-0 py-1 text-sm leading-relaxed shadow-none",
            "focus-visible:border-transparent focus-visible:ring-0",
          )}
        />
        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onStop}
            className="size-7"
            aria-label="Stop"
          >
            <HugeiconsIcon icon={Square01Icon} size={14} strokeWidth={1.75} />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="size-7"
            aria-label="Send"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={16} strokeWidth={1.75} />
          </Button>
        )}
        {onClose && (
          <Kbd className="h-5 px-2 self-center">
            ⌘<span className="font-mono">I</span>
          </Kbd>
        )}
      </div>
    </div>
  );
});
