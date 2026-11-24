import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Roboto is the portal's font (the designer's), upright and italic for emphasis; Inter is offered in
// Admin > Theming. Declaring a font fetches nothing: its files load only when text uses it.
import "@fontsource-variable/roboto";
import "@fontsource-variable/roboto/wght-italic.css";
import "@fontsource-variable/inter";
import "./styles.css";
import App from "./App";
import "./print.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
