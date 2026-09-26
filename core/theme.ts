export interface ThemePreset {
  id: string;
  /** Nuxt UI color names */
  primary: string;
  neutral: string;
  accent: string;
  label: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "matrix",
    primary: "green",
    neutral: "zinc",
    accent: "#00ff9d",
    label: "Matrix",
  },
  {
    id: "cyber",
    primary: "cyan",
    neutral: "slate",
    accent: "#22d3ee",
    label: "Cyber blue",
  },
  {
    id: "amber",
    primary: "amber",
    neutral: "stone",
    accent: "#fbbf24",
    label: "Amber terminal",
  },
  {
    id: "stealth",
    primary: "indigo",
    neutral: "gray",
    accent: "#818cf8",
    label: "Stealth gray",
  },
];

export interface AppearanceSettings {
  presetId: string;
  colorMode: "dark" | "light" | "system";
  primary: string;
  neutral: string;
  /** accent override (hex); empty/undefined → follows the live `--ui-primary` token */
  accent?: string;
  radius: number;
  fontSize: number;
  density: "compact" | "comfortable";
  bubbleStyle: "classic" | "flat";
  texture: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  presetId: "matrix",
  colorMode: "dark",
  primary: "green",
  neutral: "zinc",
  accent: undefined,
  radius: 0.5,
  fontSize: 16,
  density: "comfortable",
  bubbleStyle: "classic",
  texture: true,
  reducedMotion: false,
};

/**
 * The ONE accent source. When the user set an explicit accent (hex) it wins;
 * otherwise the accent FOLLOWS the global primary color through Nuxt UI's
 * reactive `--ui-primary` token (the colors plugin re-emits `--ui-*` whenever
 * `appConfig.ui.colors.primary` changes — verified in @nuxt/ui/plugins/colors).
 * This is what makes Settings + Magazine (and everything reading `--tp-accent`)
 * follow the global theme switcher instead of a hardcoded green.
 */
export function accentFor(ap: AppearanceSettings): string {
  return ap.accent || "var(--ui-primary)";
}

/** Surface palette per resolved color mode (kept "terminal" flavored in both). */
export const THEME_SURFACES = {
  dark: { bg: "#050807", panel: "#0a0f0d", border: "#1c2a24" },
  light: { bg: "#e9efeb", panel: "#f7faf8", border: "#d3ded7" },
} as const;

/** Accent swatches offered in Settings → Appearance (empty = preset default). */
export const ACCENT_OPTIONS = [
  { value: "", label: "Preset default" },
  { value: "#00ff9d", label: "Matrix green" },
  { value: "#22d3ee", label: "Cyan" },
  { value: "#fbbf24", label: "Amber" },
  { value: "#a3e635", label: "Lime" },
  { value: "#818cf8", label: "Indigo" },
  { value: "#f472b6", label: "Pink" },
  { value: "#fb7185", label: "Rose" },
  { value: "#e879f9", label: "Fuchsia" },
] as const;

/** Map appearance settings onto concrete CSS variables (applied on :root live).
 *  `resolvedMode` decides the surface palette — pass the actual color-mode value
 *  ('system' resolves to the OS preference at the call site). */
export function appearanceToCss(
  ap: AppearanceSettings,
  resolvedMode: "dark" | "light" = ap.colorMode === "system"
    ? "dark"
    : ap.colorMode,
): Record<string, string> {
  const surfaces = THEME_SURFACES[resolvedMode] ?? THEME_SURFACES.dark;
  return {
    "--ui-radius": `${ap.radius}rem`,
    "--tp-font-size": `${ap.fontSize}px`,
    "--tp-density": ap.density === "compact" ? "0.42rem" : "0.75rem",
    "--tp-accent": accentFor(ap),
    "--tp-bg": surfaces.bg,
    "--tp-panel": surfaces.panel,
    "--tp-border": surfaces.border,
    "color-scheme": resolvedMode,
  };
}

export const DISAPPEARING_OPTIONS = [
  { value: 0, label: "off" },
  { value: 3600, label: "1h" },
  { value: 86_400, label: "1d" },
  { value: 604_800, label: "7d" },
] as const;
