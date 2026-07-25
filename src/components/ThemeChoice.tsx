import {Label, Radio, RadioGroup, useTheme} from "@heroui/react";
import {Monitor, Moon, Sun} from "lucide-react";

const OPTIONS = [
  {value: "light", label: "Light", Icon: Sun},
  {value: "dark", label: "Dark", Icon: Moon},
  {value: "system", label: "System", Icon: Monitor},
] as const;

/**
 * The single theme controller for the whole app.
 *
 * `useTheme` persists the *intent* — including "system" — and writes both the
 * class and `data-theme` to <html>. The inline script in index.html replays the
 * same resolution before first paint, which is what removes the flash.
 */
export function ThemeChoice() {
  const {theme, setTheme} = useTheme("system");

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted">Appearance</Label>
      <RadioGroup
        aria-label="Appearance"
        orientation="horizontal"
        value={theme}
        onChange={setTheme}
        className="gap-1"
      >
        {OPTIONS.map(({value, label, Icon}) => (
          <Radio key={value} value={value} className="flex-1">
            <Radio.Content className="flex-col gap-1.5 rounded-lg px-2 py-2 text-xs">
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}
