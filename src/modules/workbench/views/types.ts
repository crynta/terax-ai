import type { Tab } from "@/modules/tabs/lib/tabs";

export type ViewProps<T extends Tab = Tab> = {
  tab: T;
  /** On screen: the active tab of a shown card. */
  visible: boolean;
  /** The focused card's tab in its task; receives keyboard focus when shown. */
  focused: boolean;
};
