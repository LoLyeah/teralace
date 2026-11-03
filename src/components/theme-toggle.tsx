import { Moon, Sun, Monitor, Check } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground relative transition-colors"
          title="Toggle Theme"
          aria-label="Toggle visual theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-sky-400" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs min-w-[120px]">
        <DropdownMenuItem 
          onClick={() => setTheme("light")}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Sun className="h-3.5 w-3.5 text-amber-500" />
          <span>Light</span>
          {theme === "light" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("dark")}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Moon className="h-3.5 w-3.5 text-sky-400" />
          <span>Dark</span>
          {theme === "dark" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("system")}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          <span>System</span>
          {theme === "system" && <Check className="ml-auto h-3.5 w-3.5 text-primary stroke-[2.5]" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
