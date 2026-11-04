import { createFileRoute } from "@tanstack/react-router";
import { FEEDBACK_MAX_BODY_BYTES, FeedbackSchema } from "@/lib/feedback";
import { readBoundedRequestBody } from "@/lib/query-api";
import { captureServerEvent } from "@/lib/server-analytics";

export async function feedbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  // Production HTTPS terminates at the load balancer; the application can see an HTTP URL.
  if (origin !== url.origin && origin !== `https://${url.host}`) {
    return new Response(null, { status: 403 });
  }
  let payload: ReturnType<typeof FeedbackSchema.parse>;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid content type");
    const body = await readBoundedRequestBody(request, FEEDBACK_MAX_BODY_BYTES);
    if (body === null) throw new Error("Request too large");
    payload = FeedbackSchema.parse(JSON.parse(body));
  } catch {
    return Response.json({ message: "A valid report and affirmative privacy consent are required." }, { status: 400 });
  }
  const { feature, version, source_id, ...properties } = payload;
  try {
    await captureServerEvent("dataset_quality_feedback_submitted", {
      ...properties,
      ...(version !== undefined ? { version } : {}),
      ...(source_id !== undefined ? { source_id } : {}),
      consent_timestamp: new Date().toISOString(),
      ...(feature ? { feature_json: JSON.stringify(feature) } : {}),
    });
    return Response.json({ status: "received" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { message: "Feedback could not be delivered. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/feedback")({
  server: { handlers: { POST: ({ request }) => feedbackHandler(request) } },
});
