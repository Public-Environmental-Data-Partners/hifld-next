import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { PostHogProvider } from "../components/PostHogProvider";
import { PageLoader } from "../components/ui/page-loader";
import { usePageTracking } from "../hooks/usePageTracking";
import appCss from "../styles.css?url";

const PEDP_FAVICON =
  "https://images.squarespace-cdn.com/content/v1/6793060d1570ff20aceb1125/1bf945a1-a73f-4823-a4d5-7cfc42a96bfa/favicon.ico";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "HIFLD Next | PEDP",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: PEDP_FAVICON,
        type: "image/webp",
      },
      {
        rel: "alternate",
        type: "application/json",
        href: "/api",
        title: "Public JSON API index",
      },
      {
        rel: "alternate",
        type: "text/markdown",
        href: "/llms.txt",
        title: "Agent-oriented API overview",
      },
    ],
  }),

  component: RootLayout,
  shellComponent: RootDocument,
  pendingComponent: PendingLayout,
  pendingMs: 300,
});

function PendingLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center">
          <PageLoader size="lg" />
        </div>
      </main>
      <Footer />
    </div>
  );
}

function RootLayout() {
  // Track page views at the root level
  usePageTracking();

  return (
    <PostHogProvider>
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
        <Footer />
      </div>
    </PostHogProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="overflow-x-hidden">
        {children}
        {/* <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        /> */}
        <Scripts />
      </body>
    </html>
  );
}
