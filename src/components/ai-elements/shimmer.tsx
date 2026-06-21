"use client";

import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType } from "react";
import { createElement, memo, useMemo } from "react";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return createElement(
    Component,
    {
      className: cn(
        "terax-shimmer relative inline-block bg-clip-text text-transparent",
        className
      ),
      style: {
        "--shimmer-spread": `${dynamicSpread}px`,
        "--shimmer-duration": `${duration}s`,
      } as CSSProperties,
    },
    children
  );
};

export const Shimmer = memo(ShimmerComponent);
