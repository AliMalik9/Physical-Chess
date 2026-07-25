import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {Toast} from "@heroui/react";

import "./styles/app.css";
import {App} from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Root element is missing from index.html");

/*
 * No theme provider: HeroUI v3 is CSS-driven, so the theme lives on <html> and
 * is set by the inline script in index.html before first paint, then kept in
 * sync by useTheme() inside the settings menu.
 */
createRoot(container).render(
  <StrictMode>
    {/*
      Top-end keeps confirmations clear of both the board and the mobile action
      bar; the default bottom-centre placement sits directly over them.
    */}
    <Toast.Provider placement="top end" />
    <App />
  </StrictMode>,
);
