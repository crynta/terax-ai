import { useVoiceController } from "./useVoiceController";
import { VoiceHud } from "./VoiceHud";

export type VoiceRuntimeProps = {
  resolveTarget: () => (text: string) => void;
};

export function VoiceRuntime({ resolveTarget }: VoiceRuntimeProps) {
  useVoiceController({ resolveTarget });
  return <VoiceHud />;
}
