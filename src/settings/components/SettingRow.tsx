import { type ReactNode, useId } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type SettingRowControlIds = {
  descriptionId?: string;
  labelId: string;
};

type Props = {
  title: ReactNode;
  description?: string;
  children: ReactNode | ((ids: SettingRowControlIds) => ReactNode);
  className?: string;
};

export function SettingRow({ title, description, children, className }: Props) {
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const control =
    typeof children === "function"
      ? children({ labelId, descriptionId })
      : children;

  return (
    <Field
      orientation="horizontal"
      className={cn(
        "flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5",
        className,
      )}
    >
      <FieldContent className="min-w-0 gap-0.5">
        <FieldTitle id={labelId} className="text-[12.5px] font-medium">
          {title}
        </FieldTitle>
        {description ? (
          <FieldDescription
            id={descriptionId}
            className="text-[10.5px] leading-relaxed text-muted-foreground"
          >
            {description}
          </FieldDescription>
        ) : null}
      </FieldContent>
      <div className="flex shrink-0 items-center">{control}</div>
    </Field>
  );
}
