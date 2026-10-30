import { edgeAppearance } from "./ArchitectureEdge";

export function ArchitectureLegend() {
  return <details className="arch-legend" open><summary>Legend</summary><ul>{Object.entries(edgeAppearance).map(([kind, item]) => <li key={kind}><i style={{ borderColor: item.color, borderStyle: item.dash ? "dashed" : "solid" }} /> <b>{item.marker}</b> {item.label}</li>)}</ul></details>;
}
