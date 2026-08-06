// Personal appearance settings (0061_personal_theme.sql): light/dark mode,
// a button/accent color override, and a font choice. Background
// image/color is handled separately in AppShell (it's just a background-*
// style, not a CSS-variable/palette concern like these are).

export function hexToHslTriplet(hex) {
  if (!hex) return null
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null

  const bigint = parseInt(full, 16)
  const r = ((bigint >> 16) & 255) / 255
  const g = ((bigint >> 8) & 255) / 255
  const b = (bigint & 255) / 255
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
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

// Dark-mode palette, paired with the app's teal-green brand hue. Surfaces
// darken/desaturate, text/borders stay high-contrast, accent colors
// brighten slightly to read well against a dark background.
export const DARK_PALETTE = {
  '--background': '160 15% 9%',
  '--foreground': '150 15% 92%',
  '--card': '160 14% 13%',
  '--card-foreground': '150 15% 92%',
  '--popover': '160 14% 13%',
  '--popover-foreground': '150 15% 92%',
  '--primary': '158 55% 48%',
  '--primary-foreground': '160 20% 8%',
  '--primary-dark': '158 55% 32%',
  '--secondary': '160 14% 18%',
  '--secondary-foreground': '150 15% 88%',
  '--muted': '160 10% 17%',
  '--muted-foreground': '160 8% 62%',
  '--accent': '38 85% 58%',
  '--accent-foreground': '30 40% 12%',
  '--destructive': '0 65% 58%',
  '--destructive-foreground': '0 0% 100%',
  '--border': '160 12% 24%',
  '--input': '160 12% 24%',
  '--ring': '158 55% 48%',
}

export const LIGHT_PALETTE = {
  '--background': '150 20% 98%',
  '--foreground': '160 20% 10%',
  '--card': '0 0% 100%',
  '--card-foreground': '160 20% 10%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '160 20% 10%',
  '--primary': '158 64% 36%',
  '--primary-foreground': '0 0% 100%',
  '--primary-dark': '166 62% 24%',
  '--secondary': '150 30% 94%',
  '--secondary-foreground': '160 30% 18%',
  '--muted': '160 12% 95%',
  '--muted-foreground': '160 8% 45%',
  '--accent': '38 92% 50%',
  '--accent-foreground': '30 40% 15%',
  '--destructive': '0 72% 51%',
  '--destructive-foreground': '0 0% 100%',
  '--border': '160 12% 89%',
  '--input': '160 12% 89%',
  '--ring': '158 64% 36%',
}

// Applies theme_mode's palette to :root, then layers the user's accent
// color (if any) on top of --primary/--primary-dark/--ring so a custom
// button color survives switching between light/dark.
export function applyTheme({ mode, accentColorHex }) {
  const palette = mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
  const root = document.documentElement.style
  for (const [key, value] of Object.entries(palette)) {
    root.setProperty(key, value)
  }

  const accentHsl = hexToHslTriplet(accentColorHex)
  if (accentHsl) {
    root.setProperty('--primary', accentHsl)
    root.setProperty('--ring', accentHsl)
    // A darker shade of the same hue for hover/emphasis states that use
    // --primary-dark, computed by just clamping lightness down rather than
    // asking the user to pick two colors.
    const [h, s, l] = accentHsl.split(' ')
    const darkerL = Math.max(parseInt(l, 10) - 14, 8)
    root.setProperty('--primary-dark', `${h} ${s} ${darkerL}%`)
  }
}

export const FONT_OPTIONS = [
  { key: 'default', label: '既定（Noto Sans JP）', family: "'Noto Sans JP', sans-serif", googleFont: null },
  {
    key: 'mplus-rounded',
    label: 'M PLUS Rounded 1c（丸くて親しみやすい）',
    family: "'M PLUS Rounded 1c', sans-serif",
    googleFont: 'M+PLUS+Rounded+1c:wght@400;500;700;900',
  },
  {
    key: 'zen-maru-gothic',
    label: 'Zen Maru Gothic（やわらかい）',
    family: "'Zen Maru Gothic', sans-serif",
    googleFont: 'Zen+Maru+Gothic:wght@400;500;700;900',
  },
  { key: 'kosugi-maru', label: 'Kosugi Maru（丸ゴシック）', family: "'Kosugi Maru', sans-serif", googleFont: 'Kosugi+Maru' },
  { key: 'sawarabi-gothic', label: 'Sawarabi Gothic（すっきり）', family: "'Sawarabi Gothic', sans-serif", googleFont: 'Sawarabi+Gothic' },
  {
    key: 'shippori-mincho',
    label: 'Shippori Mincho（明朝体）',
    family: "'Shippori Mincho', serif",
    googleFont: 'Shippori+Mincho:wght@400;500;700;800',
  },
  { key: 'custom', label: 'カスタム（自分でフォントファイルをアップロード）', family: null, googleFont: null },
]

const loadedGoogleFonts = new Set()

function loadGoogleFont(googleFontParam) {
  if (!googleFontParam || loadedGoogleFonts.has(googleFontParam)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${googleFontParam}&display=swap`
  document.head.appendChild(link)
  loadedGoogleFonts.add(googleFontParam)
}

const CUSTOM_FONT_FAMILY = 'WanderCyclingCustomFont'
let customFontStyleEl = null

function applyCustomFont(fontUrl) {
  if (!customFontStyleEl) {
    customFontStyleEl = document.createElement('style')
    document.head.appendChild(customFontStyleEl)
  }
  customFontStyleEl.textContent = `
    @font-face {
      font-family: '${CUSTOM_FONT_FAMILY}';
      src: url('${fontUrl}');
      font-display: swap;
    }
  `
  document.body.style.fontFamily = `'${CUSTOM_FONT_FAMILY}', 'Noto Sans JP', sans-serif`
}

// fontChoice: one of FONT_OPTIONS' keys. customFontUrl: only used when
// fontChoice === 'custom' (a signed URL to the uploaded font file).
export function applyFont(fontChoice, customFontUrl) {
  if (fontChoice === 'custom' && customFontUrl) {
    applyCustomFont(customFontUrl)
    return
  }
  const option = FONT_OPTIONS.find((f) => f.key === fontChoice) ?? FONT_OPTIONS[0]
  if (option.googleFont) loadGoogleFont(option.googleFont)
  document.body.style.fontFamily = option.family ?? "'Noto Sans JP', sans-serif"
}
