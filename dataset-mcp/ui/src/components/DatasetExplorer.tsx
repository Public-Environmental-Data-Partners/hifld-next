import type { QueryResult } from "../mcp/contracts";

interface DatasetExplorerProps {
  result: QueryResult | null;
  staticMode: boolean;
}
export function DatasetExplorer({ result, staticMode }: DatasetExplorerProps) {
  return (
    <section aria-label="Dataset results" className="explorer">
      <div className="explorer-toolbar">
        <span className="eyebrow">HIFLD / DATA EXPLORER</span>
        {result ? (
          <span>
            {result.rows.length} rows · offset {result.offset}
          </span>
        ) : null}
      </div>
      {result ? (
        <div className="view-placeholder">
          <h2>Results ready</h2>
          <p>
            Use the table or map view when the corresponding panel is available.
          </p>
        </div>
      ) : (
        <div className="empty-state">
          <h2>Ready to explore</h2>
          <p>
            {staticMode
              ? "Waiting for the MCP host to provide a dataset query."
              : "Your dataset results will appear here."}
          </p>
        </div>
      )}
    </section>
  );
}
