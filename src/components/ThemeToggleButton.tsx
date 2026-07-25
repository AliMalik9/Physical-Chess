import {Button, Tooltip, useTheme} from "@heroui/react";
import {Moon, Sun} from "lucide-react";

/**
 * A one-tap light/dark toggle for screens with no settings menu.
 *
 * Deliberately flips between the two concrete themes rather than cycling
 * through "system": a toggle that sometimes lands on a third invisible state is
 * confusing. Full three-way control lives in the game's settings menu.
 */
export function ThemeToggleButton() {
  const {resolvedTheme, setTheme} = useTheme("system");
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        aria-label={label}
        variant="ghost"
        onPress={() => setTheme(isDark ? "light" : "dark")}
      >
        {isDark ? (
          <Sun aria-hidden="true" className="size-[1.15rem]" />
        ) : (
          <Moon aria-hidden="true" className="size-[1.15rem]" />
        )}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
