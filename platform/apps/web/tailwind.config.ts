import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#12131C', 2: '#2A2C3A', 3: '#5B5E70' },
        ivory: { DEFAULT: '#FAF7F0', 2: '#F2EDE1' },
        sun: { DEFAULT: '#C9962B', 2: '#E7C46A', 3: '#8A6516' },
        moon: '#3B4A7A',
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
