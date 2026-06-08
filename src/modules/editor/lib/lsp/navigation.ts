export type LspNavigationTarget = {
  path: string;
  line: number;
  character?: number;
};

let navigate: ((target: LspNavigationTarget) => void) | null = null;

export function setLspNavigationHandler(
  handler: ((target: LspNavigationTarget) => void) | null,
): void {
  navigate = handler;
}

export function lspNavigateTo(target: LspNavigationTarget): void {
  navigate?.(target);
}
