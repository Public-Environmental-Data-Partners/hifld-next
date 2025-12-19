import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, Map, FileJson, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const features = [
    {
      icon: <Database className="h-8 w-8" />,
      title: "Dataset Catalog",
      description:
        "Browse and search geospatial datasets with detailed metadata and connection information.",
    },
    {
      icon: <Map className="h-8 w-8" />,
      title: "PMTiles Support",
      description:
        "Vector tiles optimized for cloud storage. No tile server required.",
    },
    {
      icon: <FileJson className="h-8 w-8" />,
      title: "GeoParquet Files",
      description:
        "Efficient columnar format for geospatial data. Query with DuckDB or GDAL.",
    },
  ];

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">
            HIFLD Open Data
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Access Homeland Infrastructure Foundation-Level Data as GeoParquet,
            PMTiles, and OGC Feature API services.
          </p>
          <div className="pt-4">
            <Button asChild size="lg">
              <Link to="/catalog">
                Browse Catalog
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="text-muted-foreground mb-2">{feature.icon}</div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{feature.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>
              Get started with the HIFLD dataset catalog
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <p className="font-medium">Dataset Catalog</p>
                <p className="text-sm text-muted-foreground">
                  Browse all available datasets
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link to="/catalog">View</Link>
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <p className="font-medium">GeoServer</p>
                <p className="text-sm text-muted-foreground">
                  OGC WFS and WMS services
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href="http://localhost:8080/geoserver" target="_blank" rel="noopener">
                  Open
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
