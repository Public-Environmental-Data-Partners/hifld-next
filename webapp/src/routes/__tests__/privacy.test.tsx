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

it("uses the central PEDP policy while keeping analytics preferences local", () => {
  render(<Privacy />);
  expect(screen.getByRole("link", {name:"PEDP Privacy Policy"})).toHaveAttribute("href", "https://www.publicenvirodata.org/privacy-policy");
  expect(screen.getByRole("button", {name:"Turn off analytics"})).toBeInTheDocument();
  expect(screen.queryByText(/rotating salt/)).not.toBeInTheDocument();
  expect(screen.queryByText(/PostHog/)).not.toBeInTheDocument();
});
