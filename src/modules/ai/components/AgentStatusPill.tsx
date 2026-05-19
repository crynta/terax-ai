import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  ShieldUserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useChatStore, type AgentMeta } from "../store/chatStore";
import { useI18n } from "@/modules/i18n";

type Props = {
  onClick: () => void;
};

export function AgentStatusPill({ onClick }: Props) {
  const { t } = useI18n();
  const meta = useChatStore((s) => s.agentMeta);

  if (meta.status === "idle" && !meta.error) return null;

  const { tone, icon, label } = describe(meta, t);

  return (
    <AnimatePresence mode="wait">
      <motion.button
        key={`${meta.status}:${label}`}
        type="button"
        onClick={onClick}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-[11px] transition-colors",
          tone,
        )}
        title={t("Open AI log")}
      >
        {icon}
        <span className="max-w-[180px] truncate">{label}</span>
      </motion.button>
    </AnimatePresence>
  );
}

function describe(
  meta: AgentMeta,
  t: (key: string, vars?: Record<string, string | number>) => string,
): {
  tone: string;
  icon: React.ReactNode;
  label: string;
} {
  if (meta.status === "awaiting-approval") {
    return {
      tone:
        "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/15",
      icon: (
        <HugeiconsIcon icon={ShieldUserIcon} size={12} strokeWidth={1.75} />
      ),
      label:
        meta.approvalsPending > 1
          ? t("{{count}} approvals needed", { count: meta.approvalsPending })
          : t("Approval needed"),
    };
  }
  if (meta.status === "error") {
    return {
      tone:
        "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: meta.error ?? t("Error"),
    };
  }
  // thinking | streaming
  return {
    tone:
      "border-border/60 bg-card text-muted-foreground hover:text-foreground",
    icon: <Spinner className="size-3" />,
    label: meta.step ? t(meta.step) : t("Thinking…"),
  };
}
