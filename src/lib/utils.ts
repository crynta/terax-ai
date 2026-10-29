import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

export function isHtmlPath(path: string): boolean {
  return /\.(html|htm|xhtml)$/i.test(path)
}

export function isRenderablePath(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path)
}
