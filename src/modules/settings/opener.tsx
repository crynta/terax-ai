import { createContext, useContext } from "react";
import { openSettingsWindow } from "./openSettingsWindow";
import type { SettingsSection } from "./types";

export type OpenSettings = (section?: SettingsSection) => void;

const SettingsOpenerContext = createContext<OpenSettings>((section) => {
  void openSettingsWindow(section);
});

export const SettingsOpenerProvider = SettingsOpenerContext.Provider;

export function useOpenSettings(): OpenSettings {
  return useContext(SettingsOpenerContext);
}
