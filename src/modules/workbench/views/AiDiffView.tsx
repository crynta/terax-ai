import { useChatStore } from "@/modules/ai/store/chatStore";
import { AiDiffPane } from "@/modules/editor/AiDiffPane";
import type { AiDiffTab } from "@/modules/tabs/lib/tabs";
import { memo } from "react";
import type { ViewProps } from "./types";

export default memo(function AiDiffView({ tab }: ViewProps<AiDiffTab>) {
  const respond = useChatStore((s) => s.respondToApproval);
  return (
    <div className="h-full w-full">
      <AiDiffPane
        path={tab.path}
        originalContent={tab.originalContent}
        proposedContent={tab.proposedContent}
        status={tab.status}
        isNewFile={tab.isNewFile}
        onAccept={() => respond(tab.approvalId, true)}
        onReject={() => respond(tab.approvalId, false)}
      />
    </div>
  );
});
