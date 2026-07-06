import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AUTO_SAVE_DELAY_MAX,
  AUTO_SAVE_DELAY_MIN,
  clampAutoSaveDelay,
  type EditorFormatter,
  setEditorAutoSave,
  setEditorAutoSaveDelay,
  setEditorFormatOnSave,
  setEditorFormatter,
  setEditorWordWrap,
  setVimMode,
} from "@/modules/settings/store";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LspServersGroup } from "../components/LspServersGroup";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const AUTO_SAVE_STEP = 100;

export function EditorSection() {
  const { t } = useTranslation();
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const editorWordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const editorAutoSave = usePreferencesStore((s) => s.editorAutoSave);
  const editorAutoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const editorFormatOnSave = usePreferencesStore((s) => s.editorFormatOnSave);
  const editorFormatter = usePreferencesStore((s) => s.editorFormatter);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("editor.header.title")}
        description={t("editor.header.description")}
      />

      <div className="flex flex-col gap-2">
        <Label>{t("editor.editing.label")}</Label>
        <SettingRow
          title={t("editor.editing.vimMode.title")}
          description={t("editor.editing.vimMode.description")}
        >
          <Switch
            checked={vimMode}
            onCheckedChange={(v) => void setVimMode(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("editor.editing.wordWrap.title")}
          description={t("editor.editing.wordWrap.description")}
        >
          <Switch
            checked={editorWordWrap}
            onCheckedChange={(v) => void setEditorWordWrap(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("editor.saving.label")}</Label>
        <SettingRow
          title={t("editor.saving.autoSave.title")}
          description={t("editor.saving.autoSave.description")}
        >
          <Switch
            checked={editorAutoSave}
            onCheckedChange={(v) => void setEditorAutoSave(v)}
          />
        </SettingRow>
        {editorAutoSave && (
          <AutoSaveDelayInput
            value={editorAutoSaveDelay}
            onChange={(v) => void setEditorAutoSaveDelay(v)}
          />
        )}
        <SettingRow
          title={t("editor.saving.formatOnSave.title")}
          description={t("editor.saving.formatOnSave.description")}
        >
          <Switch
            checked={editorFormatOnSave}
            onCheckedChange={(v) => void setEditorFormatOnSave(v)}
          />
        </SettingRow>
        {editorFormatOnSave && (
          <SettingRow
            title={t("editor.saving.formatter.title")}
            description={t("editor.saving.formatter.description")}
          >
            <Select
              value={editorFormatter}
              onValueChange={(v) =>
                void setEditorFormatter(v as EditorFormatter)
              }
            >
              <SelectTrigger className="h-8 w-40 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lsp">
                  {t("editor.saving.formatter.lsp")}
                </SelectItem>
                <SelectItem value="biome">Biome</SelectItem>
                <SelectItem value="prettier">Prettier</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        )}
      </div>

      <LspServersGroup />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function AutoSaveDelayInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampAutoSaveDelay(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title={t("editor.saving.autoSaveDelay.title")}
      description={t("editor.saving.autoSaveDelay.description")}
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={AUTO_SAVE_DELAY_MIN}
          max={AUTO_SAVE_DELAY_MAX}
          step={AUTO_SAVE_STEP}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">
          {t("editor.saving.autoSaveDelay.unit")}
        </span>
      </div>
    </SettingRow>
  );
}
