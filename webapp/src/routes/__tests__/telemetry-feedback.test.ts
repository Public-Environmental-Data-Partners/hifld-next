import { beforeEach, describe, expect, it, vi } from "vitest";
const { captureServerEvent } = vi.hoisted(() => ({captureServerEvent: vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/lib/server-analytics", () => ({captureServerEvent}));
import { feedbackHandler } from "../api/feedback";
function request(path: string, body: Record<string, string | boolean | Record<string, string | number>>, origin = "https://data.test") {
 return new Request(`https://data.test/api/${path}`, {method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)});
}
const feedback = {reporter_email:"analyst@example.com",comment:"Missing facility",collection_slug:"hifld",dataset_slug:"hospitals",file_slug:"hospitals",consent:true,consent_version:"2026-11-04"};
beforeEach(() => {captureServerEvent.mockClear();});
describe("consented feedback", () => {
 it("rejects missing consent and cross-origin submissions", async () => {
  expect((await feedbackHandler(request("feedback", {...feedback,consent:false}))).status).toBe(400);
  expect((await feedbackHandler(request("feedback", feedback,"https://evil.test"))).status).toBe(403);
  expect(captureServerEvent).not.toHaveBeenCalled();
 });
 it("stamps consent on the server and strips unapproved fields", async () => {
  const response = await feedbackHandler(request("feedback", {...feedback,consent_timestamp:"forged",current_url:"https://private.test/?secret=1"}));
  expect(response.status).toBe(201);
  expect(captureServerEvent).toHaveBeenCalledWith("dataset_quality_feedback_submitted",expect.objectContaining({...feedback,consent_timestamp:expect.stringMatching(/^\d{4}-/)}));
  expect(captureServerEvent.mock.calls[0]?.[1]).not.toHaveProperty("current_url");
 });
 it("reports delivery failure instead of accepting a lost report", async () => {
  captureServerEvent.mockRejectedValueOnce(new Error("secret upstream failure"));
  const response = await feedbackHandler(request("feedback", feedback));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
 });
 it("rejects oversized bodies", async () => {
  expect((await feedbackHandler(request("feedback", {...feedback, comment:"a".repeat(40_000)}))).status).toBe(400);
  expect(captureServerEvent).not.toHaveBeenCalled();
 });
});
it("accepts same-host HTTPS origins behind a TLS-terminating proxy", async () => {
 const req = new Request("http://data.test/api/feedback", {method:"POST", headers:{Origin:"https://data.test","Content-Type":"application/json"}, body:JSON.stringify(feedback)});
 expect((await feedbackHandler(req)).status).toBe(201);
});
it("rejects stale consent wording", async () => {
 expect((await feedbackHandler(request("feedback", {...feedback,consent_version:"old"}))).status).toBe(400);
});
it("stores feature context without geometry", async () => {
 const feature = {id:"layer:1",loadedLayerId:"layer",layerName:"Hospitals",collectionSlug:"hifld",datasetSlug:"hospitals",fileSlug:"hospitals",version:"v1",sourceLayerId:"hospitals",featureId:"1",centroid:{lng:-77,lat:38},properties:{name:"General"},geometry:{type:"Point",coordinates:[-77,38]}};
 const req = new Request("https://data.test/api/feedback", {method:"POST", headers:{Origin:"https://data.test","Content-Type":"application/json"}, body:JSON.stringify({...feedback,feature})});
 expect((await feedbackHandler(req)).status).toBe(201);
 const stored = JSON.parse(String(captureServerEvent.mock.calls[0]?.[1]?.feature_json));
 expect(stored).not.toHaveProperty("geometry");
 expect(stored.properties).toEqual({name:"General"});
});
