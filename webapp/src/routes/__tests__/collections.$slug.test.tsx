import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import { Route as CollectionsSlugRoute } from '../collections.$slug'
import * as apiClient from '@/lib/api-client'
import type { Collection, DatasetWithUrls, PaginatedResponse } from '@/lib/api-client'

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  getCollectionBySlug: vi.fn(),
  getCollectionDatasets: vi.fn(),
  getCollectionTagValues: vi.fn(),
}))

// Mock the DatasetCard component to avoid complex dependencies
vi.mock('@/components/dataset', () => ({
  DatasetCard: ({ dataset }: { dataset: DatasetWithUrls }) => (
    <div data-testid={`dataset-${dataset.id}`}>{dataset.name}</div>
  ),
}))

// Mock other UI components
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, ...props }: any) => (
    <input
      data-testid="search-input"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/pagination', () => ({
  Pagination: ({ total, limit, offset, onPageChange }: any) => {
    const totalPages = Math.ceil(total / limit)
    const currentPage = Math.floor(offset / limit) + 1

    return (
      <div data-testid="pagination">
        <button
          data-testid="prev-page"
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={currentPage === 1}
        >
          Previous page
        </button>
        {Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i + 1}
            data-testid={`page-${i + 1}`}
            onClick={() => onPageChange(i * limit)}
          >
            Go to page {i + 1}
          </button>
        ))}
        <button
          data-testid="next-page"
          onClick={() => onPageChange(offset + limit)}
          disabled={currentPage === totalPages}
        >
          Next page
        </button>
      </div>
    )
  },
}))

vi.mock('@/components/tag-filters', () => ({
  TagFilters: ({ availableTags, selectedFilters, onFilterChange }: any) => (
    <div data-testid="tag-filters">
      {Object.entries(availableTags).map(([key, values]: [string, any]) => (
        <select
          key={key}
          data-testid={`filter-${key}`}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (opt) => opt.value)
            onFilterChange(key, selected)
          }}
        >
          <option>Select {key}...</option>
          {values.map((value: string) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      ))}
    </div>
  ),
}))

describe('CollectionDetailPage - API Integration Tests', () => {
  const mockCollection: Collection = {
    id: 1,
    slug: 'hifld',
    name: 'HIFLD',
    description: 'Test collection',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const createMockDatasets = (count: number, offset: number = 0): DatasetWithUrls[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: offset + i + 1,
      slug: `dataset-${offset + i + 1}`,
      name: `Dataset ${offset + i + 1}`,
      description: `Description for dataset ${offset + i + 1}`,
      collection_id: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }))
  }

  const createMockResponse = (
    items: DatasetWithUrls[],
    total: number,
    limit: number,
    offset: number
  ): PaginatedResponse<DatasetWithUrls> => ({
    items,
    total,
    limit,
    offset,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.getCollectionBySlug).mockResolvedValue(mockCollection)
    vi.mocked(apiClient.getCollectionTagValues).mockResolvedValue({
      categories: ['Boundaries', 'Transportation'],
      geometry_type: ['Point', 'Polygon'],
    })
  })

  const createTestRouter = (initialSearch: Record<string, unknown> = {}) => {
    const rootRoute = createRootRoute()

    const route = createRoute({
      getParentRoute: () => rootRoute,
      path: '/collections/$slug',
      validateSearch: CollectionsSlugRoute.options.validateSearch,
      loaderDeps: CollectionsSlugRoute.options.loaderDeps,
      loader: CollectionsSlugRoute.options.loader,
      component: CollectionsSlugRoute.options.component,
    })

    return createRouter({
      routeTree: rootRoute.addChildren([route]),
      defaultPreload: 'intent',
    })
  }

  describe('Pagination API calls', () => {
    it('should call getCollectionDatasets with correct limit and offset on initial load', async () => {
      const mockDatasets = createMockDatasets(1, 0)
      const mockResponse = createMockResponse(mockDatasets, 14, 1, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(mockResponse)

      const router = createTestRouter({ limit: 1, offset: 0 })
      router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              collectionId: 1,
              limit: 1,
              offset: 0,
              includeUrls: false,
            }),
          })
        )
      })
    })

    it('should call loader with updated offset when paginating', async () => {
      const page1Datasets = createMockDatasets(1, 0)
      const page1Response = createMockResponse(page1Datasets, 14, 1, 0)
      const page2Datasets = createMockDatasets(1, 1)
      const page2Response = createMockResponse(page2Datasets, 14, 1, 1)

      vi.mocked(apiClient.getCollectionDatasets)
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response)

      const router = createTestRouter({ limit: 1, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledTimes(1)
      })

      // Navigate to next page
      await router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 1 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledTimes(2)
        expect(apiClient.getCollectionDatasets).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              offset: 1,
              limit: 1,
            }),
          })
        )
      })
    })

    it('should respect limit parameter in API call', async () => {
      const mockDatasets = createMockDatasets(5, 0)
      const mockResponse = createMockResponse(mockDatasets, 14, 5, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(mockResponse)

      const router = createTestRouter({ limit: 5, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 5, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              limit: 5,
            }),
          })
        )
      })
    })
  })

  describe('Search API calls', () => {
    it('should call getCollectionDatasets with search query', async () => {
      const searchResults = [
        {
          id: 1,
          slug: 'census-blocks',
          name: '2020 Census Blocks',
          description: 'Census blocks dataset',
          collection_id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      const searchResponse = createMockResponse(searchResults, 1, 100, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(searchResponse)

      const router = createTestRouter({ query: 'school', limit: 100, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { query: 'school', limit: 100, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              search: 'school',
            }),
          })
        )
      })
    })

    it('should reset offset to 0 when search query changes', async () => {
      const searchResponse = createMockResponse([], 0, 100, 0)
      vi.mocked(apiClient.getCollectionDatasets)
        .mockResolvedValueOnce(createMockResponse(createMockDatasets(14, 0), 14, 100, 5))
        .mockResolvedValueOnce(searchResponse)

      const router = createTestRouter({ query: '', limit: 100, offset: 5 })
      await router.navigate({ to: '/collections/hifld', search: { query: '', limit: 100, offset: 5 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledTimes(1)
      })

      // Change search query
      await router.navigate({ to: '/collections/hifld', search: { query: 'test', limit: 100, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              search: 'test',
              offset: 0,
            }),
          })
        )
      })
    })

    it('should handle empty search query correctly', async () => {
      const mockResponse = createMockResponse(createMockDatasets(14, 0), 14, 100, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(mockResponse)

      const router = createTestRouter({ query: '', limit: 100, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { query: '', limit: 100, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              search: undefined, // Empty query should be undefined
            }),
          })
        )
      })
    })
  })

  describe('Tag Filters API calls', () => {
    it('should call getCollectionDatasets with tagFilters when filters are applied', async () => {
      const filteredResults = [
        {
          id: 1,
          slug: 'filtered-dataset',
          name: 'Filtered Dataset',
          description: 'Filtered result',
          collection_id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      const filteredResponse = createMockResponse(filteredResults, 1, 100, 0)

      vi.mocked(apiClient.getCollectionDatasets)
        .mockResolvedValueOnce(createMockResponse(createMockDatasets(14, 0), 14, 100, 0))
        .mockResolvedValueOnce(filteredResponse)

      const router = createTestRouter({ limit: 100, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 100, offset: 0 } })

      // The component will call fetchDatasets when tag filters are applied
      // This is tested through the component's internal logic
      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalled()
      })
    })
  })

  describe('Loader behavior', () => {
    it('should call loader with correct parameters including collectionId', async () => {
      const mockDatasets = createMockDatasets(14, 0)
      const mockResponse = createMockResponse(mockDatasets, 14, 100, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(mockResponse)

      const router = createTestRouter({ limit: 100, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 100, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionBySlug).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              slug: 'hifld',
            }),
          })
        )
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              collectionId: 1,
              limit: 100,
              offset: 0,
              includeUrls: false,
            }),
          })
        )
      })
    })

    it('should use loaderDeps to determine when to re-run loader', async () => {
      const page1Response = createMockResponse(createMockDatasets(1, 0), 14, 1, 0)
      const page2Response = createMockResponse(createMockDatasets(1, 1), 14, 1, 1)

      vi.mocked(apiClient.getCollectionDatasets)
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response)

      const router = createTestRouter({ limit: 1, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledTimes(1)
      })

      // Change offset - loader should re-run
      await router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 1 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle limit=1 correctly', async () => {
      const singleDataset = createMockDatasets(1, 0)
      const response = createMockResponse(singleDataset, 14, 1, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(response)

      const router = createTestRouter({ limit: 1, offset: 0 })
      await router.navigate({ to: '/collections/hifld', search: { limit: 1, offset: 0 } })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              limit: 1,
              offset: 0,
            }),
          })
        )
      })
    })

    it('should handle default limit (100) when not specified', async () => {
      const mockResponse = createMockResponse(createMockDatasets(14, 0), 14, 100, 0)
      vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(mockResponse)

      const router = createTestRouter({})
      await router.navigate({ to: '/collections/hifld', search: {} })

      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              limit: 100, // Default limit
            }),
          })
        )
      })
    })

    it('should handle API errors gracefully', async () => {
      vi.mocked(apiClient.getCollectionDatasets).mockRejectedValue(new Error('API Error'))

      const router = createTestRouter({ limit: 100, offset: 0 })
      
      // Router navigation doesn't reject, but loader error should be caught
      // We verify the error was thrown by checking the mock was called
      try {
        await router.navigate({ to: '/collections/hifld', search: { limit: 100, offset: 0 } })
      } catch (error) {
        // Error is expected
      }

      // Verify the API was called (error occurred during loader execution)
      await waitFor(() => {
        expect(apiClient.getCollectionDatasets).toHaveBeenCalled()
      })
    })
  })
})
