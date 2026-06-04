export type HibernationPolicyInput = {
  visible: boolean;
  hasSlot: boolean;
  hibernationEnabled: boolean;
};

export function shouldReleaseHiddenRenderer({
  visible,
  hasSlot,
  hibernationEnabled,
}: HibernationPolicyInput): boolean {
  return !visible && hasSlot && hibernationEnabled;
}
