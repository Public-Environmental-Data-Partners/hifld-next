import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommonsMemberBanner } from "@/components/CommonsMemberBanner";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="mx-auto w-full max-w-4xl px-1 sm:px-0">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            HIFLD Next
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
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
            archived the repository; this catalog hosts that preserved
            collection and makes it available in modern formats for research,
            advocacy, policy, and mapping.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
            Data is available in GeoParquet, PMTiles, geodatabase, and other
            formats. Browse collections to explore and download.
          </p>
          <div className="mt-4 sm:mt-6">
            <Button asChild size="default" className="sm:h-10 sm:px-6">
              <Link to="/collections">
                Browse Collections
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-10 sm:text-lg">
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
          <div className="mt-4 flex flex-wrap items-center justify-center gap-6 sm:gap-8">
            <CommonsMemberBanner />
          </div>
        </div>
      </div>
    </div>
  );
}
