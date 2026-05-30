import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card:        { DEFAULT: 'hsl(var(--card))',      foreground: 'hsl(var(--card-foreground))'      },
        primary:     { DEFAULT: 'hsl(var(--primary))',   foreground: 'hsl(var(--primary-foreground))'   },
        secondary:   { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))',     foreground: 'hsl(var(--muted-foreground))'     },
        accent:      { DEFAULT: 'hsl(var(--accent))',    foreground: 'hsl(var(--accent-foreground))'    },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        popover:     { DEFAULT: 'hsl(var(--popover))',   foreground: 'hsl(var(--popover-foreground))'   },
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        mono:    ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg:    '0px',
        md:    '0px',
        sm:    '0px',
        xl:    '0px',
        '2xl': '0px',
        full:  '9999px',
      },
      typography: {
        DEFAULT: {
          css: {
            'code::before': { content: 'none' },
            'code::after':  { content: 'none' },
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
export default config
