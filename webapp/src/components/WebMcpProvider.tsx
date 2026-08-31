import { useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, useCallback, useMemo } from "react";
import { type RuntimeClientConfig, runtimeClientConfigFromWindow } from "@/lib/runtime-client-config";
import { CatalogTools, type CollectionSearchNavigation } from "@/lib/webmcp/catalogTools";

export const WebMcpRuntimeConfigContext = createContext<RuntimeClientConfig | null>(null);

export function WebMcpProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => runtimeClientConfigFromWindow(), []);
  const navigate = useNavigate();
  const applySearch = useCallback<CollectionSearchNavigation>(
    async (collectionSlug, search) => {
      await navigate({
        to: "/collections/$slug",
        params: { slug: collectionSlug },
        search,
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <WebMcpRuntimeConfigContext.Provider value={config}>
      <CatalogTools applySearch={applySearch} enabled={config.webMcpEnabled} />
      {children}
    </WebMcpRuntimeConfigContext.Provider>
  );
}
