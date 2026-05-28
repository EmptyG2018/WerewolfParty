/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          DEFAULT: '#0a0f1a',
          50: '#1a2332',
          100: '#111827',
          200: '#0d1420',
          300: '#0a0f1a',
          400: '#070b12',
          500: '#05080e',
        },
        blood: {
          DEFAULT: '#dc2626',
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        moon: {
          DEFAULT: '#e2e8f0',
          glow: '#f8fafc',
          dim: '#94a3b8',
          mist: '#475569',
        },
        poison: {
          DEFAULT: '#7c3aed',
          light: '#a78bfa',
          dark: '#5b21b6',
        },
        heal: {
          DEFAULT: '#10b981',
          light: '#34d399',
          dark: '#059669',
        },
        gold: {
          DEFAULT: '#f59e0b',
          light: '#fbbf24',
          dark: '#d97706',
        },
      },
      fontFamily: {
        display: ['ZCOOL KuaiLe', 'Noto Serif SC', 'serif'],
        body: ['Noto Serif SC', 'Georgia', 'serif'],
      },
      animation: {
        'slide-up': 'slide-up 0.5s ease-out both',
        'slide-in-bottom': 'slide-in-bottom 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
        'moonrise': 'moonrise 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'breathe': 'breathe 3s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'flicker': 'flicker 2s ease-in-out infinite',
        'text-glow': 'text-glow 3s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
