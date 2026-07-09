import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: "#080808",
          card: "#111111",
          "card-hover": "#161616",
          border: "#1a1a1a",
          "border-strong": "#2a2a2a",
          white: "#FFFFFF",
          muted: "#888888",
          "muted-dim": "#555555",
          green: "#4ade80",
          red: "#f87171",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          purple: "#a78bfa",
        },
      },
      fontFamily: {
        heading: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
