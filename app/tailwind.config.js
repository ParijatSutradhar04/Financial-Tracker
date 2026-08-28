/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: '#f5f5f7',
        card: '#ffffff',
        border: '#e5e5e7',
        accent: '#5b5cf6',
        'accent-light': '#ede9fe',
        muted: '#8e8e93',
        ink: '#1c1c1e',
        'ink-secondary': '#48484a',
        green: '#30d158',
        red: '#ff3b30',
        orange: '#ff9f0a',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
        mono: ['DMMono_400Regular'],
        'mono-medium': ['DMMono_500Medium'],
      },
    },
  },
  plugins: [],
};
