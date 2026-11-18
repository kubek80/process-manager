import { ExternalLink, Wrench } from "lucide-react";
import { toolName, useCatalog } from "../lib/catalog";
import { EntryIcon } from "./EntryIcon";
import "../icons.css";

/**
 * The tool a step is done in: its icon (or a wrench), its name, and - where `link` is set and the
 * tool has an address - a link that opens the tool in a new tab.
 */
export function StepTool({ id, link = false, size = 14 }: { id: string; link?: boolean; size?: number }) {
  const { catalog } = useCatalog();
  const tool = catalog.tools.find((t) => t.id === id);
  const name = toolName(catalog, id);
  const icon = <EntryIcon icon={tool?.icon} size={size} fallback={<Wrench size={size - 3} aria-hidden="true" />} />;
  if (link && tool?.url) {
    return (
      <a className="step-tool" href={tool.url} target="_blank" rel="noopener noreferrer" title={`Open ${name} in a new tab`}>
        {icon}<span>{name}</span><ExternalLink size={12} aria-hidden="true" />
      </a>
    );
  }
  return <span className="step-tool">{icon}<span>{name}</span></span>;
}
