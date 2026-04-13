export interface MeasurementScopeAmbiguity {
  kind: "length" | "angle"
  phrase: string
  normalizedPhrase: string
  candidateFields: string[]
  question: string
  chips: string[]
}

interface DetectMeasurementScopeAmbiguityOptions {
  pendingField?: string | null
}

type MeasurementFieldOption = {
  field: string
  label: string
  cue: RegExp
}

const LENGTH_OPTIONS: MeasurementFieldOption[] = [
  { field: "diameterMm", label: "직경", cue: /(?<![샹생][크])(?:직경|지름|외경|파이|dia(?:meter)?|φ|Φ|ø|Ø)/iu },
  { field: "overallLengthMm", label: "전장", cue: /(?:전장|전체\s*길이|overall\s*length|\boal\b)/iu },
  { field: "lengthOfCutMm", label: "절삭 길이", cue: /(?:절삭\s*길이|날\s*길이|날장|유장|\bloc\b|\bcl\b|length\s*of\s*cut)/iu },
  { field: "shankDiameterMm", label: "생크 직경", cue: /(?:샹크|생크|싱크|쌩크|shank)(?:\s*(?:직경|지름|dia(?:meter)?))?/iu },
]

const ANGLE_OPTIONS: MeasurementFieldOption[] = [
  { field: "helixAngleDeg", label: "헬릭스각", cue: /(?:헬릭스\s*각?도?|나선\s*각?도?|helix(?:\s*angle)?)/iu },
  { field: "taperAngleDeg", label: "테이퍼각", cue: /(?:테이퍼\s*각?도?|taper(?:\s*angle)?)/iu },
  { field: "pointAngleDeg", label: "포인트 각도", cue: /(?:포인트\s*각도|드릴\s*포인트|point\s*angle|드릴\s*끝)/iu },
]

const ADDITIONAL_LENGTH_CUES: RegExp[] = [
  /(?:코너\s*r|corner\s*r|corner\s*radius|코너\s*반경|볼\s*반경|ball\s*radius)/iu,
  /(?:피치|thread\s*pitch|\bpitch\b)/iu,
]

const LENGTH_PHRASE_RE =
  /((?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+|\d+\s*-\s*\d+\s*\/\s*\d+)\s*(?:mm|밀리|inch|in(?:ch)?|인치|["”″])(?:\s*(?:이상|이하|초과|미만|넘는|over|under|below|at\s+least|or\s+more))?)/iu

const ANGLE_PHRASE_RE =
  /((?:\d+(?:\.\d+)?)\s*(?:도|°|deg(?:ree)?s?)(?:\s*(?:이상|이하|초과|미만|over|under|below|at\s+least|or\s+more))?)/iu

const IMPERIAL_TOOL_CONTEXT_RE = /(?:엔드밀|드릴|리머|탭|커터|공구|endmill|drill|reamer|tap|cutter|tool)/iu

function canonicalPendingField(field: string | null | undefined): string | null {
  if (!field) return null
  return field === "diameterRefine" ? "diameterMm" : field
}

function hasExplicitLengthCue(message: string): boolean {
  return LENGTH_OPTIONS.some(option => option.cue.test(message))
    || ADDITIONAL_LENGTH_CUES.some(cue => cue.test(message))
}

function hasExplicitAngleCue(message: string): boolean {
  return ANGLE_OPTIONS.some(option => option.cue.test(message))
}

function isImperialToolDiameterShorthand(message: string, phrase: string): boolean {
  return /(?:inch|in(?:ch)?|인치|["”″])/iu.test(phrase) && IMPERIAL_TOOL_CONTEXT_RE.test(message)
}

function buildLengthAmbiguity(phrase: string): MeasurementScopeAmbiguity {
  const normalizedPhrase = phrase.trim().replace(/\s+/g, " ")
  return {
    kind: "length",
    phrase,
    normalizedPhrase,
    candidateFields: LENGTH_OPTIONS.map(option => option.field),
    question: `말씀하신 "${normalizedPhrase}"이 직경 기준인지, 전장 기준인지, 절삭 길이 기준인지 확인 부탁드립니다. 생크 직경이나 다른 기준이면 직접 입력해 주세요.`,
    chips: [
      `직경 ${normalizedPhrase}`,
      `전장 ${normalizedPhrase}`,
      `절삭 길이 ${normalizedPhrase}`,
      "직접 입력",
    ],
  }
}

function buildAngleAmbiguity(phrase: string): MeasurementScopeAmbiguity {
  const normalizedPhrase = phrase.trim().replace(/\s+/g, " ")
  return {
    kind: "angle",
    phrase,
    normalizedPhrase,
    candidateFields: ANGLE_OPTIONS.map(option => option.field),
    question: `말씀하신 "${normalizedPhrase}"이 헬릭스각 기준인지, 테이퍼각 기준인지, 포인트 각도 기준인지 확인 부탁드립니다.`,
    chips: [
      `헬릭스각 ${normalizedPhrase}`,
      `테이퍼각 ${normalizedPhrase}`,
      `포인트 각도 ${normalizedPhrase}`,
      "직접 입력",
    ],
  }
}

export function detectMeasurementScopeAmbiguity(
  message: string,
  options: DetectMeasurementScopeAmbiguityOptions = {},
): MeasurementScopeAmbiguity | null {
  const clean = message.normalize("NFKC").replace(/\s+/g, " ").trim()
  if (!clean) return null

  const pendingField = canonicalPendingField(options.pendingField)
  if (pendingField && [...LENGTH_OPTIONS, ...ANGLE_OPTIONS].some(option => option.field === pendingField)) {
    return null
  }

  const lengthMatch = clean.match(LENGTH_PHRASE_RE)
  if (lengthMatch) {
    if (hasExplicitLengthCue(clean)) return null
    if (isImperialToolDiameterShorthand(clean, lengthMatch[1])) return null
    return buildLengthAmbiguity(lengthMatch[1])
  }

  const angleMatch = clean.match(ANGLE_PHRASE_RE)
  if (angleMatch) {
    if (hasExplicitAngleCue(clean)) return null
    return buildAngleAmbiguity(angleMatch[1])
  }

  return null
}
