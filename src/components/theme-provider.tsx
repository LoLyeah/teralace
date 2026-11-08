import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "dark" | "light" | "system"
export type ThemePalette = "glacier" | "sand" | "sage" | "lavender" | "terracotta" | "pearl"

export interface PaletteInfo {
  id: ThemePalette
  name: string
  label: string
  color: string
  ringColor: string
}

export const THEME_PALETTES: PaletteInfo[] = [
  { id: "glacier", name: "Glacier Sky", label: "Calm Minimal", color: "#7DD3FC", ringColor: "#334155" },
  { id: "sand", name: "Warm Sand", label: "Muted Gold", color: "#E5BA73", ringColor: "#2E3A4B" },
  { id: "sage", name: "Mineral Sage", label: "Organic", color: "#86D2B4", ringColor: "#1E3A5F" },
  { id: "lavender", name: "Dusty Lavender", label: "Subtle", color: "#A5B4FC", ringColor: "#2D3345" },
  { id: "terracotta", name: "Terracotta Clay", label: "Earthy", color: "#E29578", ringColor: "#274542" },
  { id: "pearl", name: "Frosted Pearl", label: "Architectural", color: "#CBD5E1", ringColor: "#3F4A59" },
]

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  defaultPalette?: ThemePalette
  storageKey?: string
  paletteStorageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  palette: ThemePalette
  setTheme: (theme: Theme) => void
  setPalette: (palette: ThemePalette) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  palette: "glacier",
  setTheme: () => null,
  setPalette: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultPalette = "glacier",
  storageKey = "vite-ui-theme",
  paletteStorageKey = "vite-ui-palette",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [palette, setPalette] = useState<ThemePalette>(
    () => (localStorage.getItem(paletteStorageKey) as ThemePalette) || defaultPalette
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement

    // Remove all palette classes
    THEME_PALETTES.forEach((p) => {
      root.classList.remove(`palette-${p.id}`)
    })

    root.classList.add(`palette-${palette}`)
  }, [palette])

  const value = {
    theme,
    palette,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    },
    setPalette: (newPalette: ThemePalette) => {
      localStorage.setItem(paletteStorageKey, newPalette)
      setPalette(newPalette)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
