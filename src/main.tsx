import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
// offered in Admin > Theming; its files are fetched only when the font is in use
import "@fontsource-variable/roboto";
import "./styles.css";
import App from "./App";
import "./print.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
