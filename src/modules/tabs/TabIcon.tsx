import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  Clock01Icon,
  ComputerTerminal02Icon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Tab } from "./lib/useTabs";

type Props = {
  tab: Tab;
  size?: number;
  strokeWidth?: number;
  iconClassName?: string;
  imageClassName?: string;
};

export function TabIcon({
  tab,
  size = 14,
  strokeWidth = 2,
  iconClassName = "shrink-0",
  imageClassName = "size-3.5 shrink-0",
}: Props) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? <img src={url} alt="" className={imageClassName} /> : null;
  }
  if (tab.kind === "preview") {
    return iconNode(Globe02Icon, size, strokeWidth, iconClassName);
  }
  if (tab.kind === "ai-diff") {
    return iconNode(GitCompareIcon, size, strokeWidth, iconClassName);
  }
  if (tab.kind === "terminal" && tab.private) {
    return iconNode(IncognitoIcon, size, strokeWidth, iconClassName);
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return iconNode(GitCompareIcon, size, strokeWidth, iconClassName);
  }
  if (tab.kind === "git-history") {
    return iconNode(Clock01Icon, size, strokeWidth, iconClassName);
  }
  return iconNode(ComputerTerminal02Icon, size, strokeWidth, iconClassName);
}

function iconNode(
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"],
  size: number,
  strokeWidth: number,
  className: string,
) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  );
}
