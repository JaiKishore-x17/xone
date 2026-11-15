/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "xone-black": "#000000",
        "xone-obsidian": "#121212",
        "xone-card": "#181818",
        "xone-hover": "#282828",
        "xone-coral": "#FF5E4D",
        "xone-coral-hover": "#FF7466",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Circular",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
