import { createContext, useContext } from "react";

/** Consumer = follow processes and give feedback. Editor = also change processes and the catalog. */
export type Mode = "consumer" | "editor";
export const ModeContext = createContext<Mode>("consumer");
export const useEditor = () => useContext(ModeContext) === "editor";
