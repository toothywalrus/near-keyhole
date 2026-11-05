import "@fontsource-variable/newsreader/index.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
