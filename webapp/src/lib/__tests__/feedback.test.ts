import { afterEach, expect, it, vi } from "vitest";
import { feedbackHandler } from "@/routes/api/feedback";
import { FEEDBACK_MAX_BODY_BYTES, FeedbackSchema, submitDatasetQualityFeedback } from "../feedback";
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
const feature = {id:"layer:1",loadedLayerId:"layer",layerName:"Hospitals",collectionSlug:"hifld",datasetSlug:"hospitals",fileSlug:"hospitals",version:"v1",sourceLayerId:"hospitals",featureId:"1",centroid:{lng:-77,lat:38},properties:{name:"General"}};
async function sentBody(report: Parameters<typeof submitDatasetQualityFeedback>[0]): Promise<string> {
 const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:201})); vi.stubGlobal("fetch",fetcher);
 await submitDatasetQualityFeedback(report);
 const body=fetcher.mock.calls[0]?.[1]?.body;
 if (typeof body!=="string") throw new Error("Missing body");
 return body;
}
it("bounds long selected feature values instead of failing the report", async () => {
 const body=JSON.parse(await sentBody({...input,feature:{...feature,id:"x".repeat(900),properties:{name:"General",description:"d".repeat(2500),["k".repeat(250)]:"dropped"}}}));
 expect(body.comment).toBe(input.comment);
 expect(body.feature.id).toHaveLength(500);
 expect(body.feature.properties.name).toBe("General");
 expect(body.feature.properties.description).toHaveLength(2000);
 expect(Object.keys(body.feature.properties)).toHaveLength(2);
 expect(FeedbackSchema.parse(body)).toBeTruthy();
});
it.each([
 ["ASCII","a"],["non-ASCII","界"],["escaped",'"\u0001'],["emoji","😀"],
])("keeps %s feature context within the endpoint byte cap while preserving the report", async (_label, unit) => {
 const comment=unit.repeat(Math.floor(4000/unit.length));
 const properties=Object.fromEntries(Array.from({length:400},(_,index)=>[`field_${index}`,unit.repeat(Math.floor(2000/unit.length))]));
 const body=await sentBody({...input,comment,feature:{...feature,properties}});
 expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(FEEDBACK_MAX_BODY_BYTES);
 const parsed=FeedbackSchema.parse(JSON.parse(body));
 expect(parsed.comment).toBe(comment.trim());
 expect(Object.keys(parsed.feature?.properties ?? {}).length).toBeGreaterThan(0);
 const response=await feedbackHandler(new Request("https://hifld.test/api/feedback",{method:"POST",headers:{origin:"https://hifld.test","content-type":"application/json"},body}));
 expect(response.status).not.toBe(400);
});
