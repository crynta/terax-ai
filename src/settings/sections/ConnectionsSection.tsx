import {
  GoogleIcon,
  Mail01Icon,
  PlugSocketIcon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SectionHeader } from "../components/SectionHeader";

type ConnectionStub = {
  id: string;
  name: string;
  description: string;
  icon: typeof PlugSocketIcon;
};

const CONNECTIONS: ConnectionStub[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Read and search messages from the AI agent.",
    icon: Mail01Icon,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Pull files and docs into the agent's context.",
    icon: GoogleIcon,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send and read channel messages.",
    icon: SlackIcon,
  },
];

export function ConnectionsSection() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Connections"
        description="Connect Terax to your other services. Coming soon."
      />

      <div className="flex flex-col gap-2">
        {CONNECTIONS.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 opacity-70"
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-muted/40">
              <HugeiconsIcon icon={c.icon} size={16} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] font-medium">{c.name}</span>
              <span className="text-[10.5px] text-muted-foreground">
                {c.description}
              </span>
            </div>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
