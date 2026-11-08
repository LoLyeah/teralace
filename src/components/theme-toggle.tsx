import { Moon, Sun, Monitor, Check, Palette, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useTheme, THEME_PALETTES, ThemePalette } from "./theme-provider";
import { cn } from "../lib/utils";

export function ThemeToggle() {
  const { theme, setTheme, palette, setPalette, materialYou, setMaterialYou } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground relative transition-colors"
          title="Theme & Accent Color"
          aria-label="Toggle visual theme and accent color"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-400" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-primary" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs min-w-[170px] p-1.5">
        <DropdownMenuLabel className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground px-2 py-1">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuItem 
          onClick={() => setTheme("light")}
          className="flex items-center gap-2 cursor-pointer py-1.5 px-2 rounded-md"
        >
          <Sun className="h-3.5 w-3.5 text-amber-400" />
          <span>Light</span>
          {theme === "light" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("dark")}
          className="flex items-center gap-2 cursor-pointer py-1.5 px-2 rounded-md"
        >
          <Moon className="h-3.5 w-3.5 text-primary" />
          <span>Dark</span>
          {theme === "dark" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("system")}
          className="flex items-center gap-2 cursor-pointer py-1.5 px-2 rounded-md"
        >
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          <span>System</span>
          {theme === "system" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuLabel className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground px-2 py-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Material You (M3)</span>
          </span>
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded font-mono font-medium",
            materialYou ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          )}>
            {materialYou ? "ON" : "OFF"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem 
          onClick={(e) => {
            e.preventDefault();
            setMaterialYou(!materialYou);
          }}
          className="flex items-center justify-between cursor-pointer py-1.5 px-2 rounded-md hover:bg-accent/40"
        >
          <div className="flex flex-col">
            <span className="font-medium text-foreground">Dynamic Styling</span>
            <span className="text-[10px] text-muted-foreground">Tonal surfaces & pill geometry</span>
          </div>
          <span 
            className={cn(
              "relative inline-flex h-4 w-8 shrink-0 rounded-full transition-colors duration-200 ease-in-out ml-2",
              materialYou ? "bg-primary" : "bg-muted-foreground/30"
            )}
          >
            <span 
              className={cn(
                "inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ease-in-out mt-0.5",
                materialYou ? "translate-x-4 ml-0.5" : "translate-x-0.5"
              )} 
            />
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuLabel className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground px-2 py-1 flex items-center gap-1.5">
          <Palette className="h-3 w-3 text-primary" />
          <span>Color Palette</span>
        </DropdownMenuLabel>

        {THEME_PALETTES.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setPalette(p.id as ThemePalette)}
            className="flex items-center gap-2.5 cursor-pointer py-1.5 px-2 rounded-md"
          >
            <span 
              className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm shrink-0" 
              style={{ backgroundColor: p.color }}
            />
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{p.name}</span>
            </div>
            {palette === p.id && (
              <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
