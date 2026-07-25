import {Button, Separator, Switch} from "@heroui/react";

import {ThemeChoice} from "@/components/ThemeChoice";
import type {GameSettings} from "@/hooks/useGameSettings";
import {navigate} from "@/router";

/**
 * The settings body, shared by the desktop popover and the mobile drawer so the
 * two can never drift apart.
 *
 * Deliberately has no board-theme or piece-set control: Brown and Maestro are
 * the product, not a preference.
 */
export interface GameAction {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  isDestructive?: boolean;
}

export function SettingsSurface({
  settings,
  update,
  supportsHaptics,
  gameActions = [],
  onShowAttribution,
  onLeave,
  onClose,
}: {
  settings: GameSettings;
  update: (patch: Partial<GameSettings>) => void;
  supportsHaptics: boolean;
  /** Take-back, draw, resign. Empty outside an active game. */
  gameActions?: GameAction[];
  onShowAttribution: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ThemeChoice />

      <Separator />

      <div className="flex flex-col gap-3">
        <SettingSwitch
          label="Sound"
          isSelected={settings.sound}
          onChange={(sound) => update({sound})}
        />
        {supportsHaptics ? (
          <SettingSwitch
            label="Vibration"
            isSelected={settings.haptics}
            onChange={(haptics) => update({haptics})}
          />
        ) : null}
        <SettingSwitch
          label="Coordinates"
          isSelected={settings.coordinates}
          onChange={(coordinates) => update({coordinates})}
        />
        <SettingSwitch
          label="Move animation"
          isSelected={settings.animations}
          onChange={(animations) => update({animations})}
        />
        <SettingSwitch
          label="Flip the board"
          isSelected={settings.flipped === true}
          onChange={(flipped) => update({flipped: flipped ? true : null})}
        />
      </div>

      {gameActions.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-col items-start gap-1">
            <span className="px-1 text-xs font-medium text-muted">
              This game
            </span>
            {gameActions.map((action) => (
              <Button
                key={action.label}
                variant={action.isDestructive ? "danger-soft" : "ghost"}
                size="sm"
                isDisabled={action.isDisabled ?? false}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      <Separator />

      <div className="flex flex-col items-start gap-1">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            onClose();
            navigate("/how-it-works");
          }}
        >
          How it works
        </Button>
        <Button variant="ghost" size="sm" onPress={onShowAttribution}>
          About the board artwork
        </Button>
        <Button variant="danger-soft" size="sm" onPress={onLeave}>
          Leave game
        </Button>
      </div>
    </div>
  );
}

function SettingSwitch({
  label,
  isSelected,
  onChange,
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch isSelected={isSelected} onChange={onChange}>
      <Switch.Content className="w-full justify-between">
        <span className="text-sm">{label}</span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
