import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app/App";
// Fonts are bundled with the app, so no visitor's address is sent to a font service.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/noto-sans-devanagari/wght.css";
import "./styles/app.css";
import "./styles/ui.css";

// In development a hot update can run this file again. Mounting a second app on
// the same node breaks the page, so the first root is kept and reused.
const hot = import.meta.hot;
const root: Root = (hot?.data.root as Root | undefined) ?? createRoot(document.getElementById("root")!);
if (hot) hot.data.root = root;

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
