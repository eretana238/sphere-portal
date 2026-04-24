// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  usePathname() {
    return '/'
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Mock Firebase
jest.mock('@/lib/firebase', () => ({
  firestore: {},
  storage: {},
}))

// Mock toast notifications
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}))

// Mock Algolia
jest.mock('algoliasearch', () => ({
  algoliasearch: jest.fn(() => ({
    initIndex: jest.fn(() => ({
      search: jest.fn(() => Promise.resolve({ hits: [] })),
    })),
    searchSingleIndex: jest.fn(() => Promise.resolve({ hits: [] })),
  })),
}))

// Set up environment variables for tests
process.env.NEXT_PUBLIC_ALGOLIA_APP_ID = 'test-app-id'
process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY = 'test-api-key'

// Polyfill ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Suppress React warnings from third-party components (Radix UI, etc.)
// These warnings are common with complex UI libraries and don't indicate actual problems
const originalError = console.error
beforeAll(() => {
  console.error = (...args) => {
    // Suppress act() warnings
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: An update to') &&
      args[0].includes('inside a test was not wrapped in act(...)')
    ) {
      return
    }
    // Suppress ref warnings from Radix UI components
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: Function components cannot be given refs')
    ) {
      return
    }
    originalError(...args)
  }
})

afterAll(() => {
  console.error = originalError
})

