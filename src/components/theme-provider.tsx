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
  defaultMaterialYou?: boolean
  storageKey?: string
  paletteStorageKey?: string
  materialYouStorageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  palette: ThemePalette
  materialYou: boolean
  setTheme: (theme: Theme) => void
  setPalette: (palette: ThemePalette) => void
  setMaterialYou: (enabled: boolean) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  palette: "glacier",
  materialYou: true,
  setTheme: () => null,
  setPalette: () => null,
  setMaterialYou: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultPalette = "glacier",
  defaultMaterialYou = true,
  storageKey = "vite-ui-theme",
  paletteStorageKey = "vite-ui-palette",
  materialYouStorageKey = "vite-ui-material-you",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [palette, setPalette] = useState<ThemePalette>(
    () => (localStorage.getItem(paletteStorageKey) as ThemePalette) || defaultPalette
  )
  const [materialYou, setMaterialYouState] = useState<boolean>(() => {
    const saved = localStorage.getItem(materialYouStorageKey)
    if (saved !== null) {
      return saved === "true"
    }
    return defaultMaterialYou
  })

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

  useEffect(() => {
    const root = window.document.documentElement
    if (materialYou) {
      root.classList.add("material-you")
    } else {
      root.classList.remove("material-you")
    }
  }, [materialYou])

  const value = {
    theme,
    palette,
    materialYou,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    },
    setPalette: (newPalette: ThemePalette) => {
      localStorage.setItem(paletteStorageKey, newPalette)
      setPalette(newPalette)
    },
    setMaterialYou: (enabled: boolean) => {
      localStorage.setItem(materialYouStorageKey, String(enabled))
      setMaterialYouState(enabled)
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
