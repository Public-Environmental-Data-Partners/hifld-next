import type { ApiLinkMap } from "@/lib/api-links";

/** RFC 7807-style problem response for JSON APIs (application/problem+json). */

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string | undefined;
  instance?: string | undefined;
  links?: ApiLinkMap | undefined;
};

export type JsonProblemOptions = {
  type?: string | undefined;
  instance?: string | undefined;
  links?: ApiLinkMap | undefined;
};

export function jsonProblem(status: number, title: string, detail?: string, opts?: JsonProblemOptions): Response {
  const type = opts?.type ?? "about:blank";
  const body: ProblemBody = {
    type,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(opts?.instance !== undefined ? { instance: opts.instance } : {}),
    ...(opts?.links !== undefined ? { links: opts.links } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
}
