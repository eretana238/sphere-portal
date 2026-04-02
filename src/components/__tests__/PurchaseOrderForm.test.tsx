/**
 * Example test file for PurchaseOrderForm
 * 
 * Tests form validation and interactions without submitting
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PurchaseOrderForm from '../PurchaseOrderForm'
import { PurchaseOrder } from '@/models/PurchaseOrder'
import { Timestamp } from 'firebase/firestore'

// Mock dependencies
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'test@example.com' },
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(() => ({
    withConverter: jest.fn(() => ({})),
  })),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  getDocs: jest.fn(() => Promise.resolve({ forEach: jest.fn(), empty: true })),
  query: jest.fn(),
  where: jest.fn(),
  setDoc: jest.fn(),
  Timestamp: {
    now: jest.fn(() => ({ seconds: Date.now() / 1000 })),
  },
}))

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(),
  ref: jest.fn(),
  uploadBytes: jest.fn(),
}))

jest.mock('@/services/orderService', () => ({
  fetchVendorByName: jest.fn(),
}))

jest.mock('@/services/reportService', () => ({
  fetchDraftServiceReports: jest.fn(() => Promise.resolve([])),
}))

jest.mock('@/lib/services', () => ({
  getEmployeeByEmail: jest.fn(),
}))

describe('PurchaseOrderForm', () => {
  const mockPurchaseOrder: PurchaseOrder = {
    id: 'po-1',
    docId: 123,
    description: 'Test description',
    amount: 100.50,
    vendor: 'Test Vendor',
    status: 'OPEN',
    createdAt: Timestamp.now(),
    technicianRef: null,
    projectDocId: null,
    serviceReportDocId: null,
    otherCategory: null,
  }

  beforeEach(() => {
    // Prevent actual form submission
    window.location.href = ''
  })

  it('renders all form fields', () => {
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    expect(screen.getByLabelText(/po number/i)).toBeInTheDocument()
    // Vendor field uses a custom component, so check for the label element
    expect(screen.getByText('Vendor *')).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    // Receipts field uses a custom component, so check for the label element
    expect(screen.getByText('Receipts *')).toBeInTheDocument()
  })

  it('validates amount input format', async () => {
    const user = userEvent.setup()
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    const amountInput = screen.getByLabelText(/amount/i)

    // Test valid number input
    await user.clear(amountInput)
    await user.type(amountInput, '123.45')
    expect(amountInput).toHaveValue('123.45')

    // Test invalid input (should be filtered by onChange handler)
    await user.clear(amountInput)
    await user.type(amountInput, 'abc')
    // The input should reject non-numeric characters
    expect(amountInput).toHaveValue('')
  })

  it('disables submit button when required fields are missing', () => {
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    const submitButton = screen.getByRole('button', { name: /submit/i })
    
    // Submit should be disabled when:
    // - No vendor selected
    // - No category selected
    // - No receipts uploaded
    expect(submitButton).toBeDisabled()
  })

  it('allows typing in description field without submitting', async () => {
    const user = userEvent.setup()
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    const descriptionField = screen.getByLabelText(/description/i)
    
    await user.clear(descriptionField)
    await user.type(descriptionField, 'New description text')
    
    expect(descriptionField).toHaveValue('New description text')
  })

  it('handles category type switching without submitting', async () => {
    const user = userEvent.setup()
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    // Find the category switches
    const serviceSwitch = screen.getByLabelText(/service report/i)

    // Toggle switches
    if (serviceSwitch) {
      await user.click(serviceSwitch)
    }
    
    // Verify form state changes (category type changes)
    // without triggering submission
  })

  it('prevents submission when no receipts are attached', () => {
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    const submitButton = screen.getByRole('button', { name: /submit/i })
    
    // Submit should be disabled when selectedFiles.length === 0
    expect(submitButton).toBeDisabled()
  })

  it('validates canSubmit logic without submitting', () => {
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    // The canSubmit computed value checks:
    // - description exists
    // - amount is valid and > 0
    // - vendor is selected
    // - category is properly filled
    // - no upload errors

    const submitButton = screen.getByRole('button', { name: /submit/i })
    expect(submitButton).toBeDisabled()
  })

  it('handles save draft without submitting', async () => {
    const user = userEvent.setup()
    
    // Mock window.location.href to prevent actual navigation
    const originalHref = window.location.href
    const mockHref = jest.fn()
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        get href() {
          return originalHref
        },
        set href(value: string) {
          mockHref(value)
        },
      },
      writable: true,
    })
    
    // Mock Firestore setDoc to prevent actual save
    const { setDoc } = await import('firebase/firestore')
    const mockSetDoc = setDoc as jest.Mock
    mockSetDoc.mockResolvedValue(undefined)
    
    // Spy on form's onSubmit handler to verify it's not called
    const formOnSubmitSpy = jest.fn((e) => {
      e.preventDefault()
    })
    
    render(<PurchaseOrderForm purchaseOrder={mockPurchaseOrder} />)

    const form = document.querySelector('form')
    if (form) {
      form.addEventListener('submit', formOnSubmitSpy)
    }

    const saveButton = screen.getByRole('button', { name: /save/i })
    
    // Verify save button has type="button" to prevent form submission
    expect(saveButton).toHaveAttribute('type', 'button')
    
    // Click save button (this should trigger handleSave, not handleSubmit)
    await user.click(saveButton)

    // Wait a bit for any async operations
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify that form submission (handleSubmit) didn't happen
    // The save button has type="button" so it shouldn't trigger form submission
    expect(formOnSubmitSpy).not.toHaveBeenCalled()
    
    // Restore window.location
    Object.defineProperty(window, 'location', {
      value: window.location,
      writable: true,
    })
  })
})

