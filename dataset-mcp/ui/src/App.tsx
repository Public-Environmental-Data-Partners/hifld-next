import { MapView } from "./components/MapView";
import { useMcpApp } from "./mcp/useMcpApp";
import "./styles.css";

export default function App() {
  const { app, error, mapConfiguration, queryTokens, registerTeardownHandler } =
    useMcpApp();

  if (error) {
    return (
      <main className="map-state map-state-error" role="alert">
        {error}
      </main>
    );
  }
  if (!mapConfiguration) {
    return (
      <main className="map-state" role="status">
        Waiting for map…
      </main>
    );
  }
  return (
    <main className="map-shell">
      <header className="map-heading">
        <h2>{mapConfiguration.title}</h2>
      </header>
      <MapView
        configuration={mapConfiguration}
        queryTokens={queryTokens}
        app={app}
        registerTeardownHandler={registerTeardownHandler}
      />
    </main>
  );
}
