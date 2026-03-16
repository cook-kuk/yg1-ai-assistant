"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import {
  type Inquiry,
  type Product,
  type DemoScenario,
  type InquiryStatus,
  type Quote,
  type EscalationCase,
  mockInquiries,
  mockProducts,
  mockEscalationCases,
  demoScenarios
} from './mock-data'

interface AppState {
  inquiries: Inquiry[]
  products: Product[]
  escalationCases: EscalationCase[]
  quotes: Quote[]
  currentUser: {
    name: string
    role: 'sales' | 'rnd' | 'admin'
    nameKr: string
  }
  demoScenario: DemoScenario
  compareProducts: Product[]
  notifications: Notification[]
  language: 'ko' | 'en'
}

interface Notification {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message: string
}

interface AppContextType extends AppState {
  setDemoScenario: (scenario: DemoScenario) => void
  setUserRole: (role: 'sales' | 'rnd' | 'admin') => void
  setLanguage: (lang: 'ko' | 'en') => void
  updateInquiryStatus: (id: string, status: InquiryStatus) => void
  addMessageToInquiry: (inquiryId: string, message: { sender: 'customer' | 'sales' | 'ai' | 'system'; content: string }) => void
  addToCompare: (product: Product) => void
  removeFromCompare: (productId: string) => void
  clearCompare: () => void
  addNotification: (notification: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  updateEscalationStatus: (id: string, status: 'approved' | 'rejected', notes?: string) => void
  createQuote: (inquiryId: string, items: Quote['items'], tone: Quote['tone']) => Quote
  updateQuoteStatus: (quoteId: string, status: Quote['status']) => void
  markInquiryResult: (inquiryId: string, result: 'won' | 'lost', reason?: string) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

const userRoles = {
  sales: { name: 'Sales Rep', nameKr: '영업 담당자', role: 'sales' as const },
  rnd: { name: 'R&D Specialist', nameKr: '기술 전문가', role: 'rnd' as const },
  admin: { name: 'Admin', nameKr: '관리자', role: 'admin' as const }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    inquiries: mockInquiries,
    products: mockProducts,
    escalationCases: mockEscalationCases,
    quotes: [],
    currentUser: userRoles.sales,
    demoScenario: null,
    compareProducts: [],
    notifications: [],
    language: 'ko'
  })

  const setDemoScenario = useCallback((scenario: DemoScenario) => {
    setState(prev => ({ ...prev, demoScenario: scenario }))
  }, [])

  const setUserRole = useCallback((role: 'sales' | 'rnd' | 'admin') => {
    setState(prev => ({ ...prev, currentUser: userRoles[role] }))
  }, [])

  const setLanguage = useCallback((lang: 'ko' | 'en') => {
    setState(prev => ({ ...prev, language: lang }))
  }, [])

  const updateInquiryStatus = useCallback((id: string, status: InquiryStatus) => {
    setState(prev => ({
      ...prev,
      inquiries: prev.inquiries.map(inq =>
        inq.id === id ? { ...inq, status } : inq
      )
    }))
  }, [])

  const addMessageToInquiry = useCallback((inquiryId: string, message: { sender: 'customer' | 'sales' | 'ai' | 'system'; content: string }) => {
    setState(prev => ({
      ...prev,
      inquiries: prev.inquiries.map(inq =>
        inq.id === inquiryId
          ? {
              ...inq,
              messages: [
                ...inq.messages,
                {
                  id: `MSG-${Date.now()}`,
                  ...message,
                  timestamp: new Date().toISOString()
                }
              ]
            }
          : inq
      )
    }))
  }, [])

  const addToCompare = useCallback((product: Product) => {
    setState(prev => {
      if (prev.compareProducts.length >= 3) return prev
      if (prev.compareProducts.find(p => p.id === product.id)) return prev
      return { ...prev, compareProducts: [...prev.compareProducts, product] }
    })
  }, [])

  const removeFromCompare = useCallback((productId: string) => {
    setState(prev => ({
      ...prev,
      compareProducts: prev.compareProducts.filter(p => p.id !== productId)
    }))
  }, [])

  const clearCompare = useCallback(() => {
    setState(prev => ({ ...prev, compareProducts: [] }))
  }, [])

  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    const id = `notif-${Date.now()}`
    setState(prev => ({
      ...prev,
      notifications: [...prev.notifications, { ...notification, id }]
    }))
    setTimeout(() => {
      setState(prev => ({
        ...prev,
        notifications: prev.notifications.filter(n => n.id !== id)
      }))
    }, 5000)
  }, [])

  const removeNotification = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      notifications: prev.notifications.filter(n => n.id !== id)
    }))
  }, [])

  const updateEscalationStatus = useCallback((id: string, status: 'approved' | 'rejected', notes?: string) => {
    setState(prev => ({
      ...prev,
      escalationCases: prev.escalationCases.map(esc =>
        esc.id === id
          ? {
              ...esc,
              status,
              specialistNotes: notes,
              reviewedBy: prev.currentUser.nameKr,
              reviewedAt: new Date().toISOString()
            }
          : esc
      )
    }))
  }, [])

  const createQuote = useCallback((inquiryId: string, items: Quote['items'], tone: Quote['tone']) => {
    const quote: Quote = {
      id: `QT-${Date.now()}`,
      inquiryId,
      items,
      tone,
      status: 'draft',
      notes: '',
      createdAt: new Date().toISOString()
    }
    setState(prev => ({
      ...prev,
      quotes: [...prev.quotes, quote]
    }))
    return quote
  }, [])

  const updateQuoteStatus = useCallback((quoteId: string, status: Quote['status']) => {
    setState(prev => ({
      ...prev,
      quotes: prev.quotes.map(q =>
        q.id === quoteId ? { ...q, status } : q
      )
    }))
  }, [])

  const markInquiryResult = useCallback((inquiryId: string, result: 'won' | 'lost', _reason?: string) => {
    setState(prev => ({
      ...prev,
      inquiries: prev.inquiries.map(inq =>
        inq.id === inquiryId ? { ...inq, status: result } : inq
      )
    }))
  }, [])

  return (
    <AppContext.Provider
      value={{
        ...state,
        setDemoScenario,
        setUserRole,
        setLanguage,
        updateInquiryStatus,
        addMessageToInquiry,
        addToCompare,
        removeFromCompare,
        clearCompare,
        addNotification,
        removeNotification,
        updateEscalationStatus,
        createQuote,
        updateQuoteStatus,
        markInquiryResult
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}

export function useT() {
  const { language } = useApp()
  return (ko: string, en: string) => language === 'ko' ? ko : en
}
