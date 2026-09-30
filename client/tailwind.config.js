/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        hairline: 'var(--hairline)',
        hairlineStrong: 'var(--hairline-strong)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        muted: 'var(--muted)',
        navy: 'var(--navy)',
        navy2: 'var(--navy-2)',
        gold: 'var(--gold)',
        goldSoft: 'var(--gold-soft)',
      },
      fontFamily: {
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        pop: '0 8px 24px rgba(20, 23, 31, 0.08)',
      },
    },
  },
  plugins: [],
};
