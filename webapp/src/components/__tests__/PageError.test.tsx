import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PageError, PageNotFound } from "../PageError";

it("gives a readable recovery path without rendering raw exceptions in server HTML", () => {
  const reset = vi.fn();
  const error = new Error("SELECT secret FROM private_table at /srv/app/file.ts?token=private");
  const html = renderToStaticMarkup(<PageError error={error} reset={reset} />);
  expect(html).toContain("This page could not load");
  expect(html).toContain('data-error-code="page_unavailable"');
  expect(html).not.toMatch(/SELECT|private_table|\/srv\/|token=|stack|Show Error/i);
  render(<PageError error={error} reset={reset} />);
  fireEvent.click(screen.getByRole("button", {name: "Try again"}));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", {name: "Browse datasets"})).toHaveAttribute("href", "/collections");
  expect(screen.getByRole("link", {name: "Contact PEDP"})).toHaveAttribute("href", "mailto:hello@publicenvirodata.org");
});

it("distinguishes a missing page and avoids suggesting automatic retries", () => {
  render(<PageNotFound />);
  expect(screen.getByRole("heading", {level: 1})).toHaveTextContent("We could not find this page");
  expect(screen.queryByRole("button", {name: "Try again"})).not.toBeInTheDocument();
  expect(screen.getByText("page_not_found")).toBeInTheDocument();
  expect(screen.getByText(/Check the address/)).toBeInTheDocument();
});
