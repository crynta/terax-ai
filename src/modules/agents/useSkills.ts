import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type SkillInfo = {
  name: string;
  description: string;
  path: string;
};

export function useSkills() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<SkillInfo[]>("skill_list");
      setSkills(list);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { skills, loading, refresh };
}
