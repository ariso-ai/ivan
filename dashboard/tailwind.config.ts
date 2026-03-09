import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Solarized base tones
        sol: {
          base03: "#002b36",
          base02: "#073642",
          base01: "#586e75",
          base00: "#657b83",
          base0:  "#839496",
          base1:  "#93a1a1",
          base2:  "#eee8d5",
          base3:  "#fdf6e3",
          // Accent colors (shared between light and dark)
          yellow:  "#b58900",
          orange:  "#cb4b16",
          red:     "#dc322f",
          magenta: "#d33682",
          violet:  "#6c71c4",
          blue:    "#268bd2",
          cyan:    "#2aa198",
          green:   "#859900",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Cal Sans", "Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
