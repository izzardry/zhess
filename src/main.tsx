import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./fonts";
import "./index.css";
import { prepareFirstPaint } from "./lib/boot";

// Theme follows the system (Ztyle, color chapter: "Dark mode"). index.html already set the class
// before the first paint; this keeps it in sync when the system theme changes.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

// Fonts start loading now; the page stays invisible until they and the first layout are ready.
const reveal = prepareFirstPaint();
createRoot(document.getElementById("root")!).render(<App />);
reveal();
