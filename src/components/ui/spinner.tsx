import { cn } from "@/lib/utils";
import { useI18n } from "@/modules/i18n";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useI18n();
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      // @ts-ignore
      strokeWidth={2}
      role="status"
      aria-label={t("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
