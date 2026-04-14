/** RFC 7807-style problem response for JSON APIs (application/problem+json). */

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string;
};

export function jsonProblem(
  status: number,
  title: string,
  detail?: string,
  type = "about:blank"
): Response {
  const body: ProblemBody = {
    type,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
}
