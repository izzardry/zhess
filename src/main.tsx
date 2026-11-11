import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./fonts";
import "./index.css";

// Theme follows the system (Ztyle, color chapter: "Dark mode").
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

createRoot(document.getElementById("root")!).render(<App />);
