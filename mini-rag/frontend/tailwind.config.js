/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./public/index.html",                // CRA
    "./src/**/*.{js,jsx,ts,tsx}"          // your components
    // If using Vite, also add "./index.html"
  ],
  theme: { extend: {} },
  plugins: [],
}
