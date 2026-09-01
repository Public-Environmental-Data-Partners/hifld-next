import { expect, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

class TestResizeObserver implements ResizeObserver {
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
})

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

beforeEach(() => {
  window.__HIFLD_CLIENT_CONFIG__ = {
    publicDatasetApiUrl: "https://api.test",
    posthogKey: "ph_test",
    posthogHost: "https://posthog.test",
  }
})

// Cleanup after each test
afterEach(() => {
  cleanup()
  delete window.__HIFLD_CLIENT_CONFIG__
})
