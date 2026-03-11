"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { X, ArrowRight, ChevronLeft, ChevronRight, Play, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useApp } from "@/lib/store"
import { demoScenarios } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

interface DemoStep {
  id: number
  title: string
  description: string
  path: string
  highlight?: string
  action?: string
}

const scenarioSteps: Record<string, DemoStep[]> = {
  A: [
    { id: 1, title: "문의함 확인", description: "정보가 부족한 문의 INQ-001을 확인합니다.", path: "/inbox", highlight: "INQ-001", action: "클릭하여 상세 보기" },
    { id: 2, title: "문의 상세", description: "AI가 누락 필드를 분석하고 추가 질문을 생성합니다.", path: "/inbox/INQ-001", highlight: "필수 정보 체크리스트", action: "추가 질문 자동 생성 클릭" },
    { id: 3, title: "추천 확인", description: "추가 정보 입력 후 AI 추천 정확도가 상승합니다.", path: "/inbox/INQ-001", highlight: "추천 후보", action: "신뢰도 변화 확인" },
    { id: 4, title: "견적 작성", description: "추천 제품으로 견적을 작성합니다.", path: "/quotes", highlight: "견적 초안", action: "견적서 생성" }
  ],
  B: [
    { id: 1, title: "제품 탐색", description: "경쟁사 제품으로 YG-1 대응 제품을 찾습니다.", path: "/products", highlight: "경쟁사 제품", action: "Sandvik 입력" },
    { id: 2, title: "매칭 결과", description: "경쟁사 제품에 대응하는 YG-1 제품이 표시됩니다.", path: "/products", highlight: "대응 제품", action: "비교함에 추가" },
    { id: 3, title: "제품 비교", description: "선택한 제품들을 비교합니다.", path: "/products/compare", highlight: "비교표", action: "스펙 비교" },
    { id: 4, title: "견적 작성", description: "선택한 제품으로 견적을 작성합니다.", path: "/quotes", highlight: "견적 초안", action: "견적서 생성" }
  ],
  C: [
    { id: 1, title: "문의 확인", description: "가격/납기 문의가 포함된 케이스를 확인합니다.", path: "/inbox/INQ-002", highlight: "가격 문의", action: "상세 보기" },
    { id: 2, title: "가격/납기 표시", description: "확정/추정 가격과 납기가 표시됩니다.", path: "/inbox/INQ-002", highlight: "확정/추정 태그", action: "태그 확인" },
    { id: 3, title: "승인 요청", description: "추정 가격이 포함된 경우 승인이 필요합니다.", path: "/quotes", highlight: "내부 검토 요청", action: "검토 요청" },
    { id: 4, title: "승인 후 발송", description: "승인 완료 후 고객에게 발송합니다.", path: "/quotes", highlight: "발송", action: "시뮬레이션 발송" }
  ],
  D: [
    { id: 1, title: "문의 확인", description: "AI 신뢰도가 낮은 케이스를 확인합니다.", path: "/inbox/INQ-003", highlight: "신뢰도 낮음", action: "상세 보기" },
    { id: 2, title: "전문가 이관", description: "전문가에게 이관하여 검토를 요청합니다.", path: "/inbox/INQ-003", highlight: "전문가 이관", action: "이관 요청" },
    { id: 3, title: "전문가 검토", description: "R&D 전문가가 추천을 검토하고 승인합니다.", path: "/escalation", highlight: "검토 대기", action: "승인/반려" },
    { id: 4, title: "결과 확인", description: "승인 후 영업 담당자에게 알림이 전송됩니다.", path: "/inbox/INQ-003", highlight: "승인 완료", action: "고객 발송" }
  ],
  E: [
    { id: 1, title: "발송 완료 견적", description: "발송된 견적을 확인합니다.", path: "/quotes", highlight: "발송완료", action: "견적 선택" },
    { id: 2, title: "결과 입력", description: "수주/실주 결과를 입력합니다.", path: "/admin", highlight: "피드백 루프", action: "결과 기록" },
    { id: 3, title: "대시보드 확인", description: "결과가 대시보드 지표에 반영됩니다.", path: "/", highlight: "수주율", action: "지표 확인" },
    { id: 4, title: "품질 모니터링", description: "AI 추천 품질 변화를 확인합니다.", path: "/admin", highlight: "품질 모니터링", action: "추이 확인" }
  ]
}

export function DemoGuide() {
  const router = useRouter()
  const pathname = usePathname()
  const { demoScenario, setDemoScenario } = useApp()
  const [currentStep, setCurrentStep] = useState(0)
  const [isMinimized, setIsMinimized] = useState(false)

  const scenario = demoScenario && demoScenarios[demoScenario] ? demoScenarios[demoScenario] : null
  const steps = demoScenario && scenarioSteps[demoScenario] ? scenarioSteps[demoScenario] : []
  const currentStepData = steps.length > 0 ? steps[currentStep] : null

  useEffect(() => {
    if (demoScenario) {
      setCurrentStep(0)
      setIsMinimized(false)
    }
  }, [demoScenario])

  if (!demoScenario || !scenario || !currentStepData) return null

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      const nextStep = steps[currentStep + 1]
      setCurrentStep(currentStep + 1)
      if (nextStep.path !== pathname) {
        router.push(nextStep.path)
      }
    } else {
      setDemoScenario(null)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      const prevStep = steps[currentStep - 1]
      setCurrentStep(currentStep - 1)
      if (prevStep.path !== pathname) {
        router.push(prevStep.path)
      }
    }
  }

  const handleGoToStep = () => {
    if (currentStepData.path !== pathname) {
      router.push(currentStepData.path)
    }
  }

  if (isMinimized) {
    return (
      <Button
        className="fixed bottom-4 right-4 z-50 gap-2 bg-primary shadow-lg"
        onClick={() => setIsMinimized(false)}
      >
        <Play className="h-4 w-4" />
        Demo: {scenario.name}
      </Button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96">
      <Card className="shadow-xl border-primary/50">
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Demo Mode</p>
                <p className="text-xs text-muted-foreground">{scenario.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMinimized(true)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDemoScenario(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-1 mb-4">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-colors",
                  idx <= currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          {/* Current Step */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">
                Step {currentStep + 1}/{steps.length}
              </Badge>
              {currentStepData.highlight && (
                <Badge variant="secondary" className="text-xs">
                  {currentStepData.highlight}
                </Badge>
              )}
            </div>
            <h3 className="font-medium mb-1">{currentStepData.title}</h3>
            <p className="text-sm text-muted-foreground">{currentStepData.description}</p>
            {currentStepData.action && (
              <p className="text-xs text-primary mt-2 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                {currentStepData.action}
              </p>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent"
              onClick={handlePrev}
              disabled={currentStep === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              이전
            </Button>
            {pathname !== currentStepData.path && (
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={handleGoToStep}
              >
                해당 페이지로 이동
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto"
              onClick={handleNext}
            >
              {currentStep === steps.length - 1 ? "완료" : "다음"}
              {currentStep < steps.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
