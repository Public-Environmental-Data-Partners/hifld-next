import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, ArrowRight, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCollections } from "@/lib/api-client";

export const Route = createFileRoute("/collections/")({
  loader: async () => {
    const collections = await getCollections();
    return { collections };
  },
  component: CollectionsListPage,
});

function CollectionsListPage() {
  const { collections } = Route.useLoaderData();

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Collections</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Browse datasets organized by collection
          </p>
        </div>

        {/* Collections Grid */}
        {collections && collections.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <Card
                key={collection.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Link
                  to="/collections/$slug"
                  params={{ slug: collection.slug }}
                >
                  <CardHeader>
                    <div className="flex items-center gap-2 mb-2">
                      <Folder className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">
                        {collection.name}
                      </CardTitle>
                    </div>
                    {collection.description && (
                      <CardDescription className="line-clamp-2">
                        {collection.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Button variant="ghost" className="w-full" asChild>
                      <span>
                        View Datasets
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </span>
                    </Button>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No collections found</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
