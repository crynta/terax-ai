export type AgentNotificationDelivery = "none" | "native" | "toast" | "bell";

export function resolveAgentNotificationDelivery({
  focused,
  visible,
  allowToast,
}: {
  focused: boolean;
  visible: boolean;
  allowToast: boolean;
}): AgentNotificationDelivery {
  if (focused && visible) return "none";
  if (!focused) return "native";
  return allowToast ? "toast" : "bell";
}
