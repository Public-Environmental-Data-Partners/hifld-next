import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Privacy } from "../privacy";

afterEach(() => {
  document.cookie = "hifld_analytics=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});

it("lets visitors turn analytics off and back on from the privacy page", () => {
  render(<Privacy />);
  fireEvent.click(screen.getByRole("button", {name:"Turn off analytics"}));
  expect(document.cookie).toContain("hifld_analytics=off");
  fireEvent.click(screen.getByRole("button", {name:"Turn on analytics"}));
  expect(document.cookie).not.toContain("hifld_analytics=off");
});

it("reflects a previously saved opt-out", () => {
  document.cookie = "hifld_analytics=off; Path=/";
  render(<Privacy />);
  expect(screen.getByRole("button", {name:"Turn on analytics"})).toBeEnabled();
});

it("does not override browser privacy signals", () => {
  vi.stubGlobal("navigator", {globalPrivacyControl:true});
  render(<Privacy />);
  expect(screen.getByRole("button", {name:"Analytics disabled by browser"})).toBeDisabled();
});

it("links PEDP commitments and discloses what HIFLD Next collects", () => {
  render(<Privacy />);
  expect(screen.getByRole("link", {name:"PEDP Privacy Policy"})).toHaveAttribute("href", "https://www.publicenvirodata.org/privacy-policy");
  expect(screen.getByText(/privacy commitments and contact information/)).toBeInTheDocument();
  expect(screen.queryByText(/details about data collection, analytics providers/)).not.toBeInTheDocument();
  const items = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
  expect(items).toEqual([
    expect.stringMatching(/^Cookieless usage analytics through PostHog.*downloads/),
    expect.stringMatching(/^Dataset search terms.*filtering is imperfect/),
    expect.stringMatching(/^Failure categories.*without error messages/),
    "No session replay, automatic click capture or visitor profiles.",
    expect.stringMatching(/^Feedback only when you check the consent box.*stored separately from analytics/),
  ]);
  expect(screen.getByRole("button", {name:"Turn off analytics"})).toBeInTheDocument();
});
