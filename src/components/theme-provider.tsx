import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "dark" | "light" | "system"
export type ThemePalette = "dynamic" | "glacier" | "sand" | "sage" | "lavender" | "terracotta" | "pearl" | "rose"

export interface PaletteInfo {
  id: ThemePalette
  name: string
  label: string
  color: string
  ringColor: string
  isDynamic?: boolean
}

export const THEME_PALETTES: PaletteInfo[] = [
  { 
    id: "dynamic", 
    name: "Material You", 
    label: "Dynamic Monet", 
    color: "linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #f472b6 100%)", 
    ringColor: "#c084fc",
    isDynamic: true 
  },
  { id: "glacier", name: "Glacier Sky", label: "Calm Minimal", color: "#7DD3FC", ringColor: "#334155" },
  { id: "sand", name: "Warm Sand", label: "Muted Gold", color: "#E5BA73", ringColor: "#2E3A4B" },
  { id: "sage", name: "Mineral Sage", label: "Organic", color: "#86D2B4", ringColor: "#1E3A5F" },
  { id: "lavender", name: "Dusty Lavender", label: "Subtle", color: "#A5B4FC", ringColor: "#2D3345" },
  { id: "terracotta", name: "Terracotta Clay", label: "Earthy", color: "#E29578", ringColor: "#274542" },
  { id: "pearl", name: "Frosted Pearl", label: "Architectural", color: "#CBD5E1", ringColor: "#3F4A59" },
  { id: "rose", name: "Nordic Rose", label: "Soft Floral", color: "#FB7185", ringColor: "#E11D48" },
]

interface RGB {
  r: number
  g: number
  b: number
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

function getSystemAccentColor(): RGB | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null
  try {
    const el = document.createElement("div")
    el.style.color = "AccentColor"
    el.style.position = "absolute"
    el.style.left = "-9999px"
    el.style.top = "-9999px"
    el.style.visibility = "hidden"
    document.body.appendChild(el)
    const computed = window.getComputedStyle(el).color
    document.body.removeChild(el)

    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (match) {
      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)
      if ((r !== g || g !== b) && (r !== 0 || g !== 0 || b !== 0)) {
        return { r, g, b }
      }
    }
  } catch {
    // fallback
  }
  return null
}

function applyDynamicTheme(isDark: boolean, isMaterialYou: boolean) {
  if (typeof window === "undefined" || typeof document === "undefined") return
  const root = window.document.documentElement
  const accent = getSystemAccentColor()
  // Use system accent color or Google's signature Material 3 Monet baseline seed (256, 35%, 48%)
  const [h, s] = accent ? rgbToHsl(accent.r, accent.g, accent.b) : [256, 35, 48]

  // Harmonize saturation into standard Material 3 dynamic bounds
  const primarySat = Math.max(40, Math.min(85, s))

  if (!isDark) {
    // Light Mode Dynamic Monet
    root.style.setProperty("--primary", `${h} ${primarySat}% 40%`)
    root.style.setProperty("--primary-foreground", `0 0% 100%`)
    root.style.setProperty("--ring", `${h} ${primarySat}% 40%`)

    if (isMaterialYou) {
      root.style.setProperty("--background", `${h} 24% 96.5%`)
      root.style.setProperty("--card", `${h} 32% 99%`)
      root.style.setProperty("--popover", `${h} 32% 99%`)
      root.style.setProperty("--secondary", `${h} 22% 92%`)
      root.style.setProperty("--secondary-foreground", `${h} 45% 15%`)
      root.style.setProperty("--muted", `${h} 20% 92%`)
      root.style.setProperty("--muted-foreground", `${h} 15% 45%`)
      root.style.setProperty("--accent", `${h} 28% 88%`)
      root.style.setProperty("--accent-foreground", `${h} 45% 15%`)
      root.style.setProperty("--border", `${h} 20% 86%`)
      root.style.setProperty("--input", `${h} 20% 86%`)
    } else {
      clearTonalProperties(root)
    }
  } else {
    // Dark Mode Dynamic Monet
    const darkSat = Math.min(95, primarySat + 12)
    root.style.setProperty("--primary", `${h} ${darkSat}% 78%`)
    root.style.setProperty("--primary-foreground", `${h} 45% 10%`)
    root.style.setProperty("--ring", `${h} ${darkSat}% 78%`)

    if (isMaterialYou) {
      root.style.setProperty("--background", `${h} 26% 8%`)
      root.style.setProperty("--card", `${h} 22% 11.5%`)
      root.style.setProperty("--popover", `${h} 22% 11.5%`)
      root.style.setProperty("--secondary", `${h} 18% 17%`)
      root.style.setProperty("--secondary-foreground", `${h} 20% 95%`)
      root.style.setProperty("--muted", `${h} 16% 15%`)
      root.style.setProperty("--muted-foreground", `${h} 15% 65%`)
      root.style.setProperty("--accent", `${h} 22% 19%`)
      root.style.setProperty("--accent-foreground", `${h} 20% 95%`)
      root.style.setProperty("--border", `${h} 16% 21%`)
      root.style.setProperty("--input", `${h} 16% 21%`)
    } else {
      clearTonalProperties(root)
    }
  }
}

function clearDynamicTheme() {
  if (typeof window === "undefined" || typeof document === "undefined") return
  const root = window.document.documentElement
  root.style.removeProperty("--primary")
  root.style.removeProperty("--primary-foreground")
  root.style.removeProperty("--ring")
  clearTonalProperties(root)
}

function clearTonalProperties(root: HTMLElement) {
  root.style.removeProperty("--background")
  root.style.removeProperty("--card")
  root.style.removeProperty("--popover")
  root.style.removeProperty("--secondary")
  root.style.removeProperty("--secondary-foreground")
  root.style.removeProperty("--muted")
  root.style.removeProperty("--muted-foreground")
  root.style.removeProperty("--accent")
  root.style.removeProperty("--accent-foreground")
  root.style.removeProperty("--border")
  root.style.removeProperty("--input")
}

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
  toggleTheme: () => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  palette: "glacier",
  materialYou: true,
  setTheme: () => null,
  setPalette: () => null,
  setMaterialYou: () => null,
  toggleTheme: () => null,
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

    const applyTheme = (t: Theme) => {
      root.classList.remove("light", "dark")
      let resolved: "light" | "dark"

      if (t === "system") {
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        resolved = prefersDark ? "dark" : "light"
      } else {
        resolved = t
      }

      root.classList.add(resolved)
      root.style.colorScheme = resolved
    }

    applyTheme(theme)

    if (theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const handler = () => applyTheme("system")
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handler)
        return () => mediaQuery.removeEventListener("change", handler)
      } else if ((mediaQuery as any).addListener) {
        (mediaQuery as any).addListener(handler)
        return () => (mediaQuery as any).removeListener(handler)
      }
    }
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement

    // Remove all palette classes
    THEME_PALETTES.forEach((p) => {
      root.classList.remove(`palette-${p.id}`)
    })

    root.classList.add(`palette-${palette}`)

    if (palette === "dynamic") {
      const isDark = root.classList.contains("dark")
      applyDynamicTheme(isDark, materialYou)
    } else {
      clearDynamicTheme()
    }
  }, [palette, theme, materialYou])

  useEffect(() => {
    if (palette !== "dynamic") return
    const update = () => {
      const isDark = window.document.documentElement.classList.contains("dark")
      applyDynamicTheme(isDark, materialYou)
    }
    window.addEventListener("focus", update)
    return () => window.removeEventListener("focus", update)
  }, [palette, materialYou])

  useEffect(() => {
    const root = window.document.documentElement
    if (materialYou) {
      root.classList.add("material-you")
    } else {
      root.classList.remove("material-you")
    }
  }, [materialYou])

  const toggleTheme = () => {
    const currentIsDark = window.document.documentElement.classList.contains("dark")
    const nextTheme: Theme = currentIsDark ? "light" : "dark"
    localStorage.setItem(storageKey, nextTheme)
    setTheme(nextTheme)
  }

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
    toggleTheme,
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
