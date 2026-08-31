import { useEffect, useState } from "react";
import { DatasetExplorer } from "./components/DatasetExplorer";
import { ErrorPanel } from "./components/ErrorPanel";
import { MapView } from "./components/MapView";
import { ResultTable } from "./components/ResultTable";
import { useMcpApp } from "./mcp/useMcpApp";
import "./styles.css";

export default function App() {
  const state = useMcpApp();
  const mapConfiguration = state.mapConfiguration;
  const hasMap = mapConfiguration !== null;
  const [view, setView] = useState<"table" | "map">("table");

  useEffect(() => {
    if (!hasMap && view === "map") setView("table");
  }, [hasMap, view]);

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="kicker">PUBLIC SAFETY DATA</p>
          <h1>Dataset Explorer</h1>
          <p className="subtitle">
            Discover, inspect, and query trusted HIFLD datasets.
          </p>
        </div>
        <span className={state.connected ? "status connected" : "status"}>
          {state.connected ? "Connected" : "Static preview"}
        </span>
      </header>
      {state.error ? <ErrorPanel message={state.error} /> : null}
      {state.staticMode ? (
        <p className="host-message" role="status">
          Waiting for the MCP host to provide a dataset query.
        </p>
      ) : null}
      <DatasetExplorer result={state.result} staticMode={state.staticMode} />
      <section aria-label="Dataset views" className="dataset-views">
        <div className="view-tabs" role="tablist" aria-label="Dataset views">
          <button
            type="button"
            role="tab"
            aria-selected={view === "table"}
            onClick={() => setView("table")}
          >
            Table
          </button>
          {hasMap ? (
            <button
              type="button"
              role="tab"
              aria-selected={view === "map"}
              onClick={() => setView("map")}
            >
              Map
            </button>
          ) : null}
        </div>
        {view === "table" ? (
          <ResultTable result={state.result} app={state.app} />
        ) : (
          <MapView
            configuration={mapConfiguration}
            queryToken={state.result?.query_token ?? null}
            app={state.app}
          />
        )}
      </section>
    </main>
  );
}
