import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <div className="p-6 sm:p-10 min-h-screen flex items-center">
      <div className="max-w-4xl mx-auto w-full">
        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
            HIFLD Open Data
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Access Homeland Infrastructure Foundation-Level Data as GeoParquet,
            PMTiles, and OGC Feature API services.
          </p>
          <div className="pt-4">
            <Button asChild size="lg" className="px-8">
              <Link to="/collections">
                Browse Collections
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
