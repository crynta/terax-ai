export function isPlantUmlPath(path: string): boolean {
  return /\.(puml|plantuml|pu|wsd)$/i.test(path);
}
