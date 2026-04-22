// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — Tour Overlay (Spotlight + Tooltip 컴포지션)
// - useTour() 에 구독. isActive 가 true 이고 currentStep 이 있을 때만 렌더
// - 마지막 스텝에서 "다음" 누르면 completeTour 로 라우팅
"use client"

import { TourSpotlight } from "./tour-spotlight"
import { TourTooltip } from "./tour-tooltip"
import { useTour } from "./tour-provider"

export function TourOverlay() {
  const {
    isActive,
    currentStep,
    currentIndex,
    totalSteps,
    nextStep,
    prevStep,
    stopTour,
    completeTour,
  } = useTour()

  if (!isActive || !currentStep || totalSteps === 0) return null

  const isLast = currentIndex >= totalSteps - 1
  const handleNext = () => {
    if (isLast) completeTour()
    else nextStep()
  }

  return (
    <>
      <TourSpotlight target={currentStep.target} />
      <TourTooltip
        step={currentStep}
        index={currentIndex}
        total={totalSteps}
        onNext={handleNext}
        onPrev={prevStep}
        onClose={stopTour}
      />
    </>
  )
}

export default TourOverlay
