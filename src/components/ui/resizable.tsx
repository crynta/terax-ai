import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const DEFAULT_RESIZE_TARGET_MINIMUM_SIZE = {
  coarse: 24,
  fine: 12,
} as const

function ResizablePanelGroup({
  className,
  resizeTargetMinimumSize = DEFAULT_RESIZE_TARGET_MINIMUM_SIZE,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      resizeTargetMinimumSize={resizeTargetMinimumSize}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-20 flex w-px select-none items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 data-[separator=active]:bg-ring/70 data-[separator=hover]:bg-ring/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
