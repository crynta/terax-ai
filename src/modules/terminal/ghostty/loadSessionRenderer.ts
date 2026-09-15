type Session = {
  readonly disposed: boolean;
  readonly generation: number;
  readonly model: unknown;
  readonly surface: unknown;
};

export async function loadSessionRenderer<Renderer, Surface>(
  session: Session,
  generation: number,
  load: () => Promise<Renderer>,
  apply: (renderer: Renderer) => Surface,
): Promise<Surface | null> {
  const { model, surface } = session;
  const current = () =>
    !session.disposed &&
    session.generation === generation &&
    session.model === model &&
    session.surface === surface;
  if (!current()) return null;
  let renderer: Renderer;
  try {
    renderer = await load();
  } catch (error) {
    if (current()) throw error;
    return null;
  }
  return current() ? apply(renderer) : null;
}
