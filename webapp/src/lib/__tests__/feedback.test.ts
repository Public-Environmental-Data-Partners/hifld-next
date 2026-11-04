import { afterEach, expect, it, vi } from "vitest";
import { submitDatasetQualityFeedback } from "../feedback";
import { captureServerEvent } from "../server-analytics";
const input = {reporter_email:"analyst@example.com",comment:"Missing facility",collection_slug:"hifld",dataset_slug:"hospitals",file_slug:"hospitals",consent:true,consent_version:"2026-11-04"} as const;
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs(); document.cookie="hifld_analytics=; Max-Age=0; Path=/";});
it("delivers consented feedback while analytics are disabled, without browser cookies or referrers", async () => {
 document.cookie="hifld_analytics=off; Path=/";
 const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:201})); vi.stubGlobal("fetch",fetcher);
 await submitDatasetQualityFeedback(input);
 expect(fetcher).toHaveBeenCalledWith("/api/feedback",expect.objectContaining({credentials:"omit",referrerPolicy:"no-referrer",body:JSON.stringify(input)}));
});
it("does not send invalid consent", async () => {
 const fetcher=vi.fn(); vi.stubGlobal("fetch",fetcher);
 await expect(submitDatasetQualityFeedback({...input,consent_version:"old"})).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});
it("sends reports under an independent ID and reports upstream failure", async () => {
 vi.stubEnv("PUBLIC_POSTHOG_KEY","ph_test"); vi.stubEnv("PUBLIC_POSTHOG_HOST","https://posthog.test");
 const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:200})); vi.stubGlobal("fetch",fetcher);
 await captureServerEvent("dataset_quality_feedback_submitted",{...input,consent_timestamp:"2026-11-03T00:00:00Z"});
 const [url,options]=fetcher.mock.calls[0] ?? [];
 expect(url).toBe("https://posthog.test/i/v0/e/");
 const body=JSON.parse(options.body);
 expect(body.properties).toMatchObject({$process_person_profile:false,$geoip_disable:true,$ip:null});
 expect(body.properties.distinct_id).toMatch(/^[\da-f-]{36}$/);
 expect(options.headers).toEqual({"Content-Type":"application/json"});
 fetcher.mockResolvedValueOnce(new Response(null,{status:503}));
 await expect(captureServerEvent("dataset_quality_feedback_submitted",{...input,consent_timestamp:"now"})).rejects.toThrow("could not be delivered");
});
