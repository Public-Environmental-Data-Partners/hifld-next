import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Map, Table, FileStack, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SURVEY_URL } from "@/components/SurveyButton";

export const Route = createFileRoute("/about/")({
  component: AboutPage,
  head: () => ({
    meta: [{ title: "About | HIFLD Next | PEDP" }],
  }),
});

function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-1">
        <Link to="/">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to home
        </Link>
      </Button>

      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        HIFLD Next: Resilient Public Data Infrastructure for America’s Infrastructure Datasets
      </h1>

      <p className="mt-4 text-lg font-medium text-muted-foreground">
        Public Environmental Data Partners and Fulton Ring are launching a new hub for GIS infrastructure data that the federal government stopped producing for the public—restoring access and building a more resilient ecosystem for the future.
      </p>

      {/* Summary */}
      <section className="mt-10 space-y-4 text-muted-foreground">
        <p className="leading-relaxed">
          Public Environmental Data Partners and Fulton Ring are proud to unveil a new community-shaped hub for public GIS data, featuring more than 400 infrastructure-related datasets that the federal government once curated and shared with the public until the shutdown of its HIFLD Open data portal.
        </p>
        <p className="leading-relaxed">
          Nicknamed <strong className="text-foreground">HIFLD Next</strong>, it’s designed to sustain convenient public access to a crucial data collection today, while promoting a more resilient ecosystem for GIS and infrastructure data tomorrow. Today, it revives a federal data collection that officials used to keep communities and their infrastructure safe from environmental, weather, and public-safety threats—including events like Hurricane Maria and the 2018 Camp Fire. Tomorrow, HIFLD Next will evolve to meet the shifting needs of data users and stakeholders.
        </p>
        <p className="leading-relaxed">
          Our friends at the{" "}
          <a
            href="https://www.datarescueproject.org/hifld-data-saved/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Data Rescue Project
          </a>{" "}
          preserved the Homeland Infrastructure Foundation-Level Data (HIFLD) Open data layers. HIFLD Next transforms those saved files into a versioned, living system—modernized, searchable, and available in both legacy and contemporary formats—designed to restore continuity for planners, researchers, and infrastructure stakeholders.
        </p>
      </section>

      {/* Background: HIFLD Open */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          Background: What was HIFLD Open?
        </h2>
        <div className="mt-4 space-y-4 text-muted-foreground">
          <p className="leading-relaxed">
            Before its shutdown, <strong className="text-foreground">HIFLD Open</strong> was a public data portal known as Homeland Infrastructure Foundation-Level Data (HIFLD). Managed by the Department of Homeland Security (DHS), it was a convenient place to access several agencies’ data on critical infrastructure—power substations, nursing homes, water-treatment plants, and more.
          </p>
          <p className="leading-relaxed">
            Built after 9/11, federal civil servants and contractors began curating data on America’s most important infrastructure. Prior to that, agencies’ and state governments’ data was everywhere and nowhere: on hard drives, buried in long email chains, copied to DVDs. The result was a shared, authoritative point of reference—finally, everyone was on the same page, or map.
          </p>
          <p className="leading-relaxed">
            After DHS took down HIFLD Open, multiple grassroots efforts successfully archived the most recent versions of its data layers. HIFLD Next sources its archive from the Data Rescue Project, which captured a full snapshot of 400-plus HIFLD Open data layers and their associated metadata before the portal was taken offline.
          </p>
        </div>
      </section>

      {/* What HIFLD Next offers */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          What HIFLD Next offers
        </h2>
        <p className="mt-3 text-muted-foreground">
          HIFLD Next provides features to make the data quicker and easier to use and to ensure users can trust it:
        </p>
        <ul className="mt-4 space-y-3 text-muted-foreground">
          <li className="flex gap-3">
            <FileStack className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <span><strong className="text-foreground">Legacy and emerging file formats</strong>—GeoParquet, PMTiles, geodatabase, shapefile, and others—so you can work in the format that fits your workflow.</span>
          </li>
          <li className="flex gap-3">
            <Map className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <span><strong className="text-foreground">Map and table viewers</strong>—preview the data you’re interested in before you download it.</span>
          </li>
          <li className="flex gap-3">
            <Tags className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <span><strong className="text-foreground">Metadata</strong>—preserved and visible so you know what you’re using.</span>
          </li>
          <li className="flex gap-3">
            <Table className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <span><strong className="text-foreground">Data versioning</strong>—so the catalog can evolve while preserving a clear record of what changed.</span>
          </li>
        </ul>
      </section>

      {/* The Commons */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          The HIFLD Next Commons
        </h2>
        <div className="mt-4 space-y-4 text-muted-foreground">
          <p className="leading-relaxed">
            Alongside the platform launch, we are forming the{" "}
            <Link to="/commons" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
              HIFLD Next Commons
            </Link>
            , a coalition of mission-driven organizations committed to stewarding and expanding the catalog over time.
          </p>
        </div>
      </section>

      {/* Future plans */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          Future plans
        </h2>
        <div className="mt-4 space-y-4 text-muted-foreground">
          <p className="leading-relaxed">
            This is just the beginning. HIFLD Next shows how civil society can support the future stewardship of open infrastructure data through open approaches. It’s open data infrastructure for open infrastructure data—fueling research, innovation, and decisions with countless ramifications for the environment, community resilience, and everyday life.
          </p>
          <p className="leading-relaxed">
            We will continue to improve the platform through use, critique, and collaboration—evolving to meet the shifting needs of data users and stakeholders.
          </p>
        </div>
      </section>

      {/* How to get involved */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          How to get involved
        </h2>
        <div className="mt-4 space-y-4 text-muted-foreground">
          <p className="leading-relaxed">
            HIFLD Next will improve through use, critique, and collaboration. We encourage you to:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Use the data layers for your work—planning, research, or analysis</li>
            <li>Share your use cases with us</li>
            <li>Send feedback so we can improve the platform</li>
          </ul>
          <p className="leading-relaxed">
            We are extending an open invitation to organizations that have a stake in these data layers and want to contribute funding, data, or other resources. If your organization is interested in joining the HIFLD Next Commons as a steward or partner, we’d like to hear from you.
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          <a
            href={SURVEY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Share your interest or feedback in our survey
          </a>
          .
        </p>
      </section>
    </div>
  );
}
