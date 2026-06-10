export type ShellPhase = "prompt" | "running";

export type BlockMode = "prompt" | "running" | "alt";

export type Osc133Marker = "A" | "B" | "C" | "D";

export type ModeEvent =
  | { type: "osc133"; marker: Osc133Marker }
  | { type: "altScreen"; active: boolean };

export type ModeState = {
  phase: ShellPhase;
  altScreen: boolean;
};

export function initialModeState(): ModeState {
  return { phase: "prompt", altScreen: false };
}

export function modeOf(state: ModeState): BlockMode {
  return state.altScreen ? "alt" : state.phase;
}

export function reduceMode(state: ModeState, event: ModeEvent): ModeState {
  if (event.type === "altScreen") {
    if (state.altScreen === event.active) return state;
    return { ...state, altScreen: event.active };
  }
  const phase = phaseForMarker(event.marker);
  if (state.phase === phase) return state;
  return { ...state, phase };
}

function phaseForMarker(marker: Osc133Marker): ShellPhase {
  return marker === "C" ? "running" : "prompt";
}
