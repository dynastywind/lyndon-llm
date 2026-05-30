/**
 * Registry of syntax-highlight themes for code blocks.
 *
 * To add a new theme:
 *   1. Import it from 'react-syntax-highlighter/dist/esm/styles/prism'
 *   2. Add an entry to CODE_THEMES below
 *
 * The active theme is stored in the app store (codeTheme key) and can be
 * changed from Settings at any time.
 */
import type { CSSProperties } from 'react'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { nord } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { nightOwl } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export type SyntaxTheme = Record<string, CSSProperties>

export const CODE_THEMES: Record<string, SyntaxTheme> = {
  vscDarkPlus,
  dracula,
  oneDark,
  nord,
  nightOwl,
  atomDark,
}

export type CodeThemeName = keyof typeof CODE_THEMES

/** Ordered list for the settings dropdown. */
export const CODE_THEME_OPTIONS: { value: CodeThemeName; label: string }[] = [
  { value: 'vscDarkPlus', label: 'VS Code Dark+' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'oneDark', label: 'One Dark' },
  { value: 'nord', label: 'Nord' },
  { value: 'nightOwl', label: 'Night Owl' },
  { value: 'atomDark', label: 'Atom Dark' },
]

export const CODE_THEME_DEFAULT: CodeThemeName = 'vscDarkPlus'
