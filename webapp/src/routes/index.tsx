import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommonsMemberBanner } from "@/components/CommonsMemberBanner";
import {
  discoveryLinkHeaderValue,
  homePageMarkdown,
} from "@/lib/agent-discovery";

export const Route = createFileRoute("/")({
  component: HomePage,
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        const accept = request.headers.get("accept") ?? "";
        const wantsMarkdown =
          /\btext\/markdown\b/i.test(accept) && !/\btext\/html\b/i.test(accept);
        if (wantsMarkdown) {
          const origin = new URL(request.url).origin;
          return new Response(homePageMarkdown(origin), {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              Link: discoveryLinkHeaderValue(),
              "Cache-Control": "public, max-age=300",
            },
          });
        }
        return next();
      },
    },
  },
});

function HomePage() {
  return (
    <div>
      {/* Hero — vertically centered in the viewport */}
      <div className="flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
        <div className="mx-auto w-full max-w-4xl px-1 sm:px-0 text-center">
          <h1 className="text-5xl font-bold tracking-tighter sm:text-7xl lg:text-8xl">
            HIFLD Next
          </h1>
          <p className="font-serif mx-auto mt-10 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-12 sm:text-lg">
            The Public Environmental Data Partners are committed to preserving
            and providing public access to federal infrastructure and
            environmental data. When the original HIFLD Open portal went
            offline, the{" "}
            <a
              href="https://www.datarescueproject.org/hifld-data-saved/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Data Rescue Project
            </a>{" "}
            archived the repository. This catalog hosts that preserved
            collection—400+ datasets available in GeoParquet, PMTiles,
            geodatabase, and other formats—for research, advocacy, policy, and
            mapping.
          </p>
          <div className="mt-10 sm:mt-12">
            <Button asChild size="default" className="sm:h-10 sm:px-6">
              <Link to="/collections">
                Browse Collections
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Commons — below the fold */}
      <div className="border-t border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24 text-center">
          <p className="font-serif mx-auto max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Alongside the platform, we are forming the{" "}
            <a
              href="/commons"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              HIFLD Next Commons
            </a>
            —a coalition of mission-driven organizations committed to
            stewarding and expanding the catalog. Stewards:
          </p>
          <div className="mt-10 mx-auto grid w-fit grid-cols-2 gap-x-12 gap-y-6">
            <CommonsMemberBanner />
          </div>
        </div>
      </div>
    </div>
  );
}
