import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
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
  onPointerUp,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      // A mouse drag leaves the separator focused; the library then reports
      // "focus" instead of "hover", so hover highlights stop working. Drop
      // focus on release — keyboard focus (Tab) is unaffected.
      onPointerUp={(e) => {
        ;(e.currentTarget as HTMLElement).blur()
        onPointerUp?.(e)
      }}
      className={cn(
        "group/handle relative flex w-px items-center justify-center bg-border ring-offset-background transition-colors duration-150 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden data-[separator=hover]:bg-ring/40 data-[separator=active]:bg-ring/60 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-7 w-[3px] shrink-0 rounded-full bg-muted-foreground/35 transition-all duration-150 group-data-[separator=hover]/handle:h-9 group-data-[separator=hover]/handle:bg-ring group-data-[separator=active]/handle:h-9 group-data-[separator=active]/handle:bg-ring" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
