import { expect, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

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
