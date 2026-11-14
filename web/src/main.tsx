// Self-hosted type, so the page asks no third party for anything: Caslon for the journal, a tabular mono for the figures.
import "@fontsource/libre-caslon-text/400.css";
import "@fontsource/libre-caslon-text/400-italic.css";
import "@fontsource/libre-caslon-text/700.css";
import "@fontsource/libre-caslon-display/400.css";
import "@fontsource-variable/spline-sans-mono/index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
