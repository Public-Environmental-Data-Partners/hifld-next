import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

function ErrorContent({ notFound = false, retry }: { notFound?: boolean; retry?: (() => void) | undefined }) {
  const code = notFound ? "page_not_found" : "page_unavailable";
  return (
    <section
      aria-labelledby="page-error-title"
      data-error-code={code}
      className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24"
    >
      <p className="mb-4 text-sm font-medium text-muted-foreground">HIFLD Next · Dataset catalog</p>
      <h1 id="page-error-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {notFound ? "We could not find this page" : "This page could not load"}
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
        {notFound
          ? "The link may be out of date, or this page may have moved. Check the address or search the catalog for the dataset you need."
          : "We could not complete this request. Try again, or browse the catalog to find the dataset you need."}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {retry && (
          <Button type="button" size="lg" onClick={retry}>
            Try again
          </Button>
        )}
        <Button asChild size="lg" variant={retry ? "outline" : "default"}>
          <a href="/collections">Browse datasets</a>
        </Button>
      </div>
      <div className="mt-10 border-t pt-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          If you still need help,{" "}
          <a className="underline underline-offset-4" href="mailto:hello@publicenvirodata.org">
            Contact PEDP
          </a>{" "}
          and tell us which dataset you wanted and what you were trying to do. Please leave out confidential
          information.
        </p>
        <p className="mt-4">
          Error category: <code className="font-mono text-xs">{code}</code>
        </p>
      </div>
    </section>
  );
}

/** Never render exception messages, stacks, request URLs, or arbitrary error fields. */
export function PageError({ reset }: ErrorComponentProps) {
  return <ErrorContent retry={reset} />;
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PageError
      error={error}
      reset={() => {
        void router.invalidate();
        reset();
      }}
    />
  );
}

export function PageNotFound() {
  return <ErrorContent notFound />;
}
