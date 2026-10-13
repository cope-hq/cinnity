import { createTheme, style } from '@vanilla-extract/css';
import { color } from 'folds';

/**
 * Popular terminal/editor color schemes, generated from a small palette so
 * every theme gets the same hover/active/line steps as the built-in themes.
 */

type Kind = 'light' | 'dark';

export type TerminalPalette = {
  id: string;
  name: string;
  kind: Kind;
  /** Darkest/outer background (sidebars). */
  background: string;
  /** Main content background. */
  surface: string;
  /** Raised elements: inputs, cards, menus. */
  variant: string;
  foreground: string;
  primary: string;
  success: string;
  warning: string;
  critical: string;
  link: string;
  /** Eight accents for user-ID colors. */
  users: [string, string, string, string, string, string, string, string];
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const rgbToHex = (rgb: number[]): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

/** Mix `b` into `a` by `amount` (0 = a, 1 = b). */
const mix = (a: string, b: string, amount: number): string => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.map((c, i) => c + (cb[i] - c) * amount));
};

const alpha = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const containerSet = (base: string, fg: string) => ({
  Container: base,
  ContainerHover: mix(base, fg, 0.06),
  ContainerActive: mix(base, fg, 0.12),
  ContainerLine: mix(base, fg, 0.18),
  OnContainer: fg,
});

const accentSet = (accent: string, p: TerminalPalette) => {
  const dark = p.kind === 'dark';
  const container = mix(p.surface, accent, dark ? 0.22 : 0.18);
  return {
    Main: accent,
    MainHover: mix(accent, p.background, 0.08),
    MainActive: mix(accent, p.background, 0.12),
    MainLine: mix(accent, p.background, 0.16),
    OnMain: dark ? p.background : p.surface,
    Container: container,
    ContainerHover: mix(container, accent, 0.06),
    ContainerActive: mix(container, accent, 0.12),
    ContainerLine: mix(container, accent, 0.18),
    OnContainer: mix(accent, p.foreground, dark ? 0.5 : 0.4),
  };
};

const themeTokens = (p: TerminalPalette) => ({
  Background: containerSet(p.background, p.foreground),
  Surface: containerSet(p.surface, p.foreground),
  SurfaceVariant: containerSet(p.variant, p.foreground),
  Primary: accentSet(p.primary, p),
  Secondary: {
    ...accentSet(p.foreground, p),
    Container: mix(p.variant, p.foreground, 0.08),
    ContainerHover: mix(p.variant, p.foreground, 0.14),
    ContainerActive: mix(p.variant, p.foreground, 0.2),
    ContainerLine: mix(p.variant, p.foreground, 0.26),
    OnContainer: p.foreground,
  },
  Success: accentSet(p.success, p),
  Warning: accentSet(p.warning, p),
  Critical: accentSet(p.critical, p),
  Other: {
    FocusRing: alpha(p.foreground, 0.5),
    Shadow: p.kind === 'dark' ? 'rgba(0, 0, 0, 1)' : 'rgba(0, 0, 0, 0.2)',
    Overlay: p.kind === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.5)',
  },
});

const palettes: TerminalPalette[] = [
  // Catppuccin — https://catppuccin.com/palette
  {
    id: 'catppuccin-latte-theme',
    name: 'Catppuccin Latte',
    kind: 'light',
    background: '#e6e9ef',
    surface: '#eff1f5',
    variant: '#dce0e8',
    foreground: '#4c4f69',
    primary: '#8839ef',
    success: '#40a02b',
    warning: '#df8e1d',
    critical: '#d20f39',
    link: '#1e66f5',
    users: ['#1e66f5', '#8839ef', '#179299', '#d20f39', '#fe640b', '#04a5e5', '#7287fd', '#40a02b'],
  },
  {
    id: 'catppuccin-frappe-theme',
    name: 'Catppuccin Frappé',
    kind: 'dark',
    background: '#292c3c',
    surface: '#303446',
    variant: '#414559',
    foreground: '#c6d0f5',
    primary: '#ca9ee6',
    success: '#a6d189',
    warning: '#e5c890',
    critical: '#e78284',
    link: '#8caaee',
    users: ['#8caaee', '#ca9ee6', '#81c8be', '#e78284', '#ef9f76', '#99d1db', '#babbf1', '#a6d189'],
  },
  {
    id: 'catppuccin-macchiato-theme',
    name: 'Catppuccin Macchiato',
    kind: 'dark',
    background: '#1e2030',
    surface: '#24273a',
    variant: '#363a4f',
    foreground: '#cad3f5',
    primary: '#c6a0f6',
    success: '#a6da95',
    warning: '#eed49f',
    critical: '#ed8796',
    link: '#8aadf4',
    users: ['#8aadf4', '#c6a0f6', '#8bd5ca', '#ed8796', '#f5a97f', '#91d7e3', '#b7bdf8', '#a6da95'],
  },
  {
    id: 'catppuccin-mocha-theme',
    name: 'Catppuccin Mocha',
    kind: 'dark',
    background: '#181825',
    surface: '#1e1e2e',
    variant: '#313244',
    foreground: '#cdd6f4',
    primary: '#cba6f7',
    success: '#a6e3a1',
    warning: '#f9e2af',
    critical: '#f38ba8',
    link: '#89b4fa',
    users: ['#89b4fa', '#cba6f7', '#94e2d5', '#f38ba8', '#fab387', '#89dceb', '#b4befe', '#a6e3a1'],
  },
  // Gruvbox — https://github.com/morhetz/gruvbox
  {
    id: 'gruvbox-light-theme',
    name: 'Gruvbox Light',
    kind: 'light',
    background: '#ebdbb2',
    surface: '#fbf1c7',
    variant: '#d5c4a1',
    foreground: '#3c3836',
    primary: '#af3a03',
    success: '#79740e',
    warning: '#b57614',
    critical: '#9d0006',
    link: '#076678',
    users: ['#076678', '#8f3f71', '#427b58', '#9d0006', '#af3a03', '#427b58', '#076678', '#79740e'],
  },
  {
    id: 'gruvbox-dark-theme',
    name: 'Gruvbox Dark',
    kind: 'dark',
    background: '#1d2021',
    surface: '#282828',
    variant: '#3c3836',
    foreground: '#ebdbb2',
    primary: '#fe8019',
    success: '#b8bb26',
    warning: '#fabd2f',
    critical: '#fb4934',
    link: '#83a598',
    users: ['#83a598', '#d3869b', '#8ec07c', '#fb4934', '#fe8019', '#8ec07c', '#83a598', '#b8bb26'],
  },
  // Solarized — https://ethanschoonover.com/solarized/
  {
    id: 'solarized-light-theme',
    name: 'Solarized Light',
    kind: 'light',
    background: '#eee8d5',
    surface: '#fdf6e3',
    variant: '#e4ddc8',
    foreground: '#586e75',
    primary: '#268bd2',
    success: '#859900',
    warning: '#b58900',
    critical: '#dc322f',
    link: '#268bd2',
    users: ['#268bd2', '#d33682', '#2aa198', '#dc322f', '#cb4b16', '#2aa198', '#6c71c4', '#859900'],
  },
  {
    id: 'solarized-dark-theme',
    name: 'Solarized Dark',
    kind: 'dark',
    background: '#00212b',
    surface: '#002b36',
    variant: '#073642',
    foreground: '#93a1a1',
    primary: '#268bd2',
    success: '#859900',
    warning: '#b58900',
    critical: '#dc322f',
    link: '#268bd2',
    users: ['#268bd2', '#d33682', '#2aa198', '#dc322f', '#cb4b16', '#2aa198', '#6c71c4', '#859900'],
  },
  // Rosé Pine — https://rosepinetheme.com/palette
  {
    id: 'rose-pine-dawn-theme',
    name: 'Rosé Pine Dawn',
    kind: 'light',
    background: '#f2e9e1',
    surface: '#faf4ed',
    variant: '#fffaf3',
    foreground: '#575279',
    primary: '#907aa9',
    success: '#286983',
    warning: '#ea9d34',
    critical: '#b4637a',
    link: '#56949f',
    users: ['#286983', '#907aa9', '#56949f', '#b4637a', '#ea9d34', '#d7827e', '#907aa9', '#286983'],
  },
  {
    id: 'rose-pine-theme',
    name: 'Rosé Pine',
    kind: 'dark',
    background: '#191724',
    surface: '#1f1d2e',
    variant: '#26233a',
    foreground: '#e0def4',
    primary: '#c4a7e7',
    success: '#9ccfd8',
    warning: '#f6c177',
    critical: '#eb6f92',
    link: '#9ccfd8',
    users: ['#9ccfd8', '#c4a7e7', '#31748f', '#eb6f92', '#f6c177', '#ebbcba', '#c4a7e7', '#9ccfd8'],
  },
  {
    id: 'rose-pine-moon-theme',
    name: 'Rosé Pine Moon',
    kind: 'dark',
    background: '#232136',
    surface: '#2a273f',
    variant: '#393552',
    foreground: '#e0def4',
    primary: '#c4a7e7',
    success: '#9ccfd8',
    warning: '#f6c177',
    critical: '#eb6f92',
    link: '#9ccfd8',
    users: ['#9ccfd8', '#c4a7e7', '#3e8fb0', '#eb6f92', '#f6c177', '#ea9a97', '#c4a7e7', '#9ccfd8'],
  },
  // Nord — https://www.nordtheme.com/docs/colors-and-palettes
  {
    id: 'nord-theme',
    name: 'Nord',
    kind: 'dark',
    background: '#2e3440',
    surface: '#3b4252',
    variant: '#434c5e',
    foreground: '#eceff4',
    primary: '#88c0d0',
    success: '#a3be8c',
    warning: '#ebcb8b',
    critical: '#bf616a',
    link: '#88c0d0',
    users: ['#81a1c1', '#b48ead', '#8fbcbb', '#bf616a', '#d08770', '#88c0d0', '#5e81ac', '#a3be8c'],
  },
  // Dracula — https://draculatheme.com/contribute
  {
    id: 'dracula-theme',
    name: 'Dracula',
    kind: 'dark',
    background: '#21222c',
    surface: '#282a36',
    variant: '#44475a',
    foreground: '#f8f8f2',
    primary: '#bd93f9',
    success: '#50fa7b',
    warning: '#ffb86c',
    critical: '#ff5555',
    link: '#8be9fd',
    users: ['#8be9fd', '#bd93f9', '#50fa7b', '#ff5555', '#ffb86c', '#ff79c6', '#f1fa8c', '#6272a4'],
  },
  // Tokyo Night — https://github.com/folke/tokyonight.nvim
  {
    id: 'tokyo-night-theme',
    name: 'Tokyo Night',
    kind: 'dark',
    background: '#16161e',
    surface: '#1a1b26',
    variant: '#292e42',
    foreground: '#c0caf5',
    primary: '#7aa2f7',
    success: '#9ece6a',
    warning: '#e0af68',
    critical: '#f7768e',
    link: '#7dcfff',
    users: ['#7aa2f7', '#bb9af7', '#73daca', '#f7768e', '#ff9e64', '#7dcfff', '#e0af68', '#9ece6a'],
  },
  {
    id: 'tokyo-night-day-theme',
    name: 'Tokyo Night Day',
    kind: 'light',
    background: '#d0d5e3',
    surface: '#e1e2e7',
    variant: '#c4c8da',
    foreground: '#3760bf',
    primary: '#2e7de9',
    success: '#587539',
    warning: '#8c6c3e',
    critical: '#f52a65',
    link: '#007197',
    users: ['#2e7de9', '#9854f1', '#118c74', '#f52a65', '#b15c00', '#007197', '#7847bd', '#587539'],
  },
  // One Dark / One Light — Atom
  {
    id: 'one-dark-theme',
    name: 'One Dark',
    kind: 'dark',
    background: '#21252b',
    surface: '#282c34',
    variant: '#3e4451',
    foreground: '#abb2bf',
    primary: '#61afef',
    success: '#98c379',
    warning: '#e5c07b',
    critical: '#e06c75',
    link: '#61afef',
    users: ['#61afef', '#c678dd', '#56b6c2', '#e06c75', '#d19a66', '#56b6c2', '#e5c07b', '#98c379'],
  },
  {
    id: 'one-light-theme',
    name: 'One Light',
    kind: 'light',
    background: '#eaeaeb',
    surface: '#fafafa',
    variant: '#e5e5e6',
    foreground: '#383a42',
    primary: '#4078f2',
    success: '#50a14f',
    warning: '#c18401',
    critical: '#e45649',
    link: '#4078f2',
    users: ['#4078f2', '#a626a4', '#0184bc', '#e45649', '#986801', '#0184bc', '#c18401', '#50a14f'],
  },
  // Everforest — https://github.com/sainnhe/everforest
  {
    id: 'everforest-dark-theme',
    name: 'Everforest Dark',
    kind: 'dark',
    background: '#232a2e',
    surface: '#2d353b',
    variant: '#3d484d',
    foreground: '#d3c6aa',
    primary: '#a7c080',
    success: '#83c092',
    warning: '#dbbc7f',
    critical: '#e67e80',
    link: '#7fbbb3',
    users: ['#7fbbb3', '#d699b6', '#83c092', '#e67e80', '#e69875', '#7fbbb3', '#dbbc7f', '#a7c080'],
  },
  {
    id: 'everforest-light-theme',
    name: 'Everforest Light',
    kind: 'light',
    background: '#f4f0d9',
    surface: '#fdf6e3',
    variant: '#efebd4',
    foreground: '#5c6a72',
    primary: '#8da101',
    success: '#35a77c',
    warning: '#dfa000',
    critical: '#f85552',
    link: '#3a94c5',
    users: ['#3a94c5', '#df69ba', '#35a77c', '#f85552', '#f57d26', '#3a94c5', '#dfa000', '#8da101'],
  },
  // Kanagawa — https://github.com/rebelot/kanagawa.nvim
  {
    id: 'kanagawa-theme',
    name: 'Kanagawa',
    kind: 'dark',
    background: '#16161d',
    surface: '#1f1f28',
    variant: '#2a2a37',
    foreground: '#dcd7ba',
    primary: '#7e9cd8',
    success: '#98bb6c',
    warning: '#e6c384',
    critical: '#e46876',
    link: '#7fb4ca',
    users: ['#7e9cd8', '#957fb8', '#7aa89f', '#e46876', '#ffa066', '#7fb4ca', '#d27e99', '#98bb6c'],
  },
  // Monokai
  {
    id: 'monokai-theme',
    name: 'Monokai',
    kind: 'dark',
    background: '#1e1f1c',
    surface: '#272822',
    variant: '#3e3d32',
    foreground: '#f8f8f2',
    primary: '#a6e22e',
    success: '#a6e22e',
    warning: '#fd971f',
    critical: '#f92672',
    link: '#66d9ef',
    users: ['#66d9ef', '#ae81ff', '#a6e22e', '#f92672', '#fd971f', '#66d9ef', '#e6db74', '#a6e22e'],
  },
];

export type TerminalTheme = {
  id: string;
  name: string;
  kind: Kind;
  /** folds color tokens. */
  themeClass: string;
  /** Link and user-ID color variables from index.css. */
  varsClass: string;
};

export const terminalThemes: TerminalTheme[] = palettes.map((p) => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  themeClass: createTheme(color, themeTokens(p), p.id),
  varsClass: style(
    {
      vars: {
        '--tc-link': p.link,
        ...Object.fromEntries(p.users.map((c, i) => [`--mx-uc-${i + 1}`, c])),
      },
    },
    `${p.id}-vars`
  ),
}));
