"use client"

import { useState } from "react"
import { 
  Search, 
  BookOpen, 
  FileText, 
  MessageSquare, 
  Tag, 
  Calendar,
  ThumbsUp,
  Eye,
  Plus,
  Filter,
  ChevronRight,
  Lightbulb,
  Wrench,
  HelpCircle,
  CheckCircle,
  Star,
  ExternalLink,
  Clock,
  User
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// Mock knowledge data
const knowledgeNotes = [
  {
    id: "KN001",
    title: "SUS304 스테인리스 가공 시 채터링 방지 가이드",
    category: "가공 가이드",
    tags: ["스테인리스", "SUS304", "채터링", "엔드밀"],
    content: "SUS304 가공 시 채터링이 발생하는 주요 원인과 해결책:\n\n1. 절삭 속도 조정: Vc 80-120 m/min 권장\n2. 이송속도: fz 0.05-0.1mm/tooth\n3. 절입깊이: Ap는 공구 직경의 0.5-1배\n4. 쿨런트: 고압 쿨런트 적용 시 효과적\n5. 공구 선택: 4날 이상 엔드밀 권장, TiAlN 코팅\n\n관련 제품: V7 Plus 4F, I-Xmill 4F",
    author: "김기술",
    createdAt: "2024-01-15",
    updatedAt: "2024-02-20",
    views: 328,
    likes: 45,
    linkedInquiries: ["INQ-003", "INQ-008"],
    helpful: true
  },
  {
    id: "KN002",
    title: "알루미늄 고속가공 최적 조건",
    category: "가공 가이드",
    tags: ["알루미늄", "고속가공", "HSC", "엔드밀"],
    content: "알루미늄 고속가공(HSC) 시 최적 조건:\n\n1. 절삭 속도: Vc 500-2000 m/min\n2. 이송속도: fz 0.1-0.3mm/tooth\n3. 절입깊이: 얕은 절입 (Ap 0.1-0.5 x D)\n4. 공구: 2-3날 엔드밀, DLC 또는 무코팅\n5. 날각: 45도 이상 고헬릭스\n\n칩 배출이 핵심 - 에어블로우 필수",
    author: "박연구",
    createdAt: "2024-01-20",
    updatedAt: "2024-01-20",
    views: 256,
    likes: 38,
    linkedInquiries: ["INQ-005"],
    helpful: true
  },
  {
    id: "KN003",
    title: "인코넬 718 가공 시 공구 수명 연장 방법",
    category: "가공 가이드",
    tags: ["인코넬", "난삭재", "공구수명", "내열합금"],
    content: "인코넬 718은 대표적인 난삭재입니다.\n\n공구 수명 연장을 위한 핵심 포인트:\n1. 절삭 속도 낮추기: Vc 20-40 m/min\n2. 안정적인 절입: 진동 최소화\n3. 쿨런트: 고압 절삭유 필수 (70bar 이상)\n4. 코팅: AlCrN 또는 TiAlN 권장\n5. 공구 교체 주기: 플랭크 마모 0.2mm 이전\n\n가공 시작 전 예열 효과 고려 필요",
    author: "이전문",
    createdAt: "2024-02-01",
    updatedAt: "2024-02-15",
    views: 189,
    likes: 29,
    linkedInquiries: ["INQ-007"],
    helpful: true
  },
  {
    id: "KN004",
    title: "경쟁사 제품 대응표 - OSG vs YG-1",
    category: "경쟁사 비교",
    tags: ["OSG", "경쟁사", "제품매칭"],
    content: "OSG 주요 제품군 대응 YG-1 제품:\n\n- OSG A-SFT → YG-1 V7 Plus\n- OSG WX-EMS → YG-1 X5070\n- OSG ADO-SUS → YG-1 Dream Drill Inox\n- OSG A-TAP → YG-1 Combo Tap\n\n가격 경쟁력: YG-1 평균 15-20% 우위\n품질: 동등 수준 (일부 항목 YG-1 우위)",
    author: "최영업",
    createdAt: "2024-02-10",
    updatedAt: "2024-02-10",
    views: 412,
    likes: 67,
    linkedInquiries: ["INQ-002", "INQ-006"],
    helpful: true
  },
  {
    id: "KN005",
    title: "금형강(SKD11) 정삭 가공 볼엔드밀 선택 가이드",
    category: "제품 선택",
    tags: ["금형강", "SKD11", "볼엔드밀", "정삭"],
    content: "SKD11 금형강 정삭 시 볼엔드밀 선택 기준:\n\n경도별 권장 제품:\n- HRC 40-50: X5070 Ball\n- HRC 50-55: Alu-Power Ball\n- HRC 55-62: V7 Ball 2F\n\n형상별 선택:\n- 깊은 리브: 롱넥 타입\n- 넓은 곡면: 숏넥 고강성\n- 코너R: 테이퍼볼 고려\n\n표면조도 Ra 0.8 이하 목표 시 스텝오버 5% 이하",
    author: "김기술",
    createdAt: "2024-02-15",
    updatedAt: "2024-02-18",
    views: 278,
    likes: 41,
    linkedInquiries: ["INQ-004"],
    helpful: true
  },
  {
    id: "KN006",
    title: "납기 단축 가능 품목 리스트 (2024년 1분기)",
    category: "납기/재고",
    tags: ["납기", "재고", "긴급"],
    content: "긴급 납기 대응 가능 품목 (국내 재고 보유):\n\n엔드밀:\n- V7 Plus 4F: 6, 8, 10, 12mm\n- X5070 4F: 6, 8, 10mm\n- Alu-Power 3F: 8, 10, 12mm\n\n드릴:\n- Dream Drill: 전 규격\n- Dream Drill Inox: 6, 8, 10mm\n\n탭:\n- Combo Tap: M6, M8, M10\n\n재고 외 품목: 영업일 기준 3-5일 (국내 생산)\n특수 사양: 2-3주 (해외 생산)",
    author: "박물류",
    createdAt: "2024-01-05",
    updatedAt: "2024-03-01",
    views: 567,
    likes: 89,
    linkedInquiries: [],
    helpful: true
  }
]

const faqItems = [
  {
    id: "FAQ001",
    question: "SUS304와 SUS316 가공에 같은 공구를 사용해도 되나요?",
    answer: "기본적으로 같은 공구 사용 가능합니다. 단, SUS316은 Mo 함유로 인해 더 난삭성이 높아 절삭 속도를 10-15% 낮추는 것을 권장합니다. 장시간 가공 시에는 SUS316 전용 코팅(AlCrN) 제품 고려가 좋습니다.",
    category: "소재",
    views: 234
  },
  {
    id: "FAQ002",
    question: "엔드밀 날수는 어떻게 선택하나요?",
    answer: "일반적인 기준:\n- 2날: 알루미늄, 플라스틱 (칩 배출 우선)\n- 3날: 범용, 중간 소재\n- 4날 이상: 강재, 스테인리스 (강성 우선)\n\n황삭은 날수 적게, 정삭은 날수 많게 선택하는 것이 일반적입니다.",
    category: "공구 선택",
    views: 456
  },
  {
    id: "FAQ003",
    question: "TiAlN과 AlCrN 코팅의 차이점은?",
    answer: "TiAlN: 범용성 우수, 내열성 800도, 일반강/스테인리스에 적합\nAlCrN: 고온 안정성 우수, 내열성 1100도, 난삭재/고경도강에 적합\n\n가격은 AlCrN이 약 10-15% 높지만, 난삭재 가공 시 공구 수명 30-50% 향상 효과가 있습니다.",
    category: "코팅",
    views: 389
  },
  {
    id: "FAQ004",
    question: "최소 주문 수량(MOQ)은 어떻게 되나요?",
    answer: "표준품: MOQ 1개 (단, 운송비 별도 적용 가능)\n특수 사양: MOQ 5-10개 (제품에 따라 상이)\n대량 주문: 별도 협의 (가격 할인 적용)\n\n자세한 사항은 담당 영업에게 문의해 주세요.",
    category: "주문/납기",
    views: 278
  },
  {
    id: "FAQ005",
    question: "도면 없이 가공 조건만으로 추천 가능한가요?",
    answer: "가능합니다. 최소 필요 정보:\n1. 피삭재 종류 및 경도\n2. 가공 방식 (황삭/정삭/홀가공 등)\n3. 원하는 공구 직경\n\n도면이 있으면 더 정확한 추천이 가능하며, 특히 복잡한 형상이나 정밀 가공 시에는 도면 제공을 권장합니다.",
    category: "문의 방법",
    views: 167
  }
]

const productGuides = [
  {
    id: "PG001",
    title: "엔드밀 선택 플로우차트",
    description: "소재 → 가공방식 → 직경 순서로 최적 엔드밀 찾기",
    icon: Wrench,
    steps: [
      "1단계: 피삭재 확인 (철/비철/난삭재)",
      "2단계: 가공 방식 결정 (황삭/정삭/고속)",
      "3단계: 필요 직경 및 날 길이 확인",
      "4단계: 코팅 선택 (소재별 최적 코팅)",
      "5단계: 가공 조건표 참조하여 조건 설정"
    ]
  },
  {
    id: "PG002",
    title: "드릴 선택 가이드",
    description: "홀 가공 조건에 따른 드릴 타입 선택",
    icon: Lightbulb,
    steps: [
      "1단계: 홀 깊이 확인 (3D 이하/5D/10D 이상)",
      "2단계: 피삭재 종류 및 경도",
      "3단계: 센터링 필요 여부",
      "4단계: 정밀도 요구 수준",
      "5단계: 칩 배출 방식 선택"
    ]
  },
  {
    id: "PG003",
    title: "탭 선택 가이드",
    description: "나사 가공 조건별 탭 종류 선택",
    icon: HelpCircle,
    steps: [
      "1단계: 나사 규격 확인 (M, UNC, UNF 등)",
      "2단계: 관통홀/막힘홀 구분",
      "3단계: 피삭재 종류",
      "4단계: 기계 타입 (머시닝센터/탭핑센터)",
      "5단계: 동기/비동기 탭핑 확인"
    ]
  }
]

const categories = ["전체", "가공 가이드", "제품 선택", "경쟁사 비교", "납기/재고"]

export default function KnowledgePage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("전체")
  const [selectedNote, setSelectedNote] = useState<typeof knowledgeNotes[0] | null>(null)
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false)

  const filteredNotes = knowledgeNotes.filter(note => {
    const matchesSearch = searchQuery === "" || 
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesCategory = selectedCategory === "전체" || note.category === selectedCategory
    
    return matchesSearch && matchesCategory
  })

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              지식/가이드
            </h1>
            <p className="text-muted-foreground mt-1">
              제품 선택 가이드, 가공 노하우, 자주 묻는 질문
            </p>
          </div>
          <Dialog open={isAddNoteOpen} onOpenChange={setIsAddNoteOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                지식 노트 추가
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>새 지식 노트 작성</DialogTitle>
                <DialogDescription>
                  가공 노하우, 제품 선택 기준, 고객 대응 팁 등을 기록하세요.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">제목</label>
                  <Input placeholder="예: SUS304 황삭 시 채터링 방지 방법" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">카테고리</label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.filter(c => c !== "전체").map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">태그</label>
                    <Input placeholder="쉼표로 구분 (예: 스테인리스, 엔드밀)" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">내용</label>
                  <Textarea 
                    placeholder="상세 내용을 작성하세요..."
                    className="min-h-[200px]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">관련 문의 연결 (선택)</label>
                  <Input placeholder="문의 번호 입력 (예: INQ-001, INQ-002)" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddNoteOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => setIsAddNoteOpen(false)}>
                  저장
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="키워드로 검색 (예: 스테인리스, 채터링, OSG)"
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="notes" className="h-full flex flex-col">
          <div className="border-b px-6">
            <TabsList className="h-12">
              <TabsTrigger value="notes" className="gap-2">
                <FileText className="h-4 w-4" />
                지식 노트
                <Badge variant="secondary" className="ml-1">{filteredNotes.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                자주 묻는 질문
                <Badge variant="secondary" className="ml-1">{faqItems.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="guides" className="gap-2">
                <Lightbulb className="h-4 w-4" />
                제품 선택 가이드
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Knowledge Notes Tab */}
          <TabsContent value="notes" className="flex-1 overflow-hidden m-0">
            <div className="flex h-full">
              {/* Notes List */}
              <div className="w-1/2 border-r overflow-y-auto">
                <div className="p-4 space-y-3">
                  {filteredNotes.map(note => (
                    <Card 
                      key={note.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/50",
                        selectedNote?.id === note.id && "ring-2 ring-primary"
                      )}
                      onClick={() => setSelectedNote(note)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="font-medium line-clamp-2">{note.title}</h3>
                          <Badge variant="outline" className="shrink-0 text-xs">
                            {note.category}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {note.tags.slice(0, 3).map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {note.tags.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{note.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {note.views}
                            </span>
                            <span className="flex items-center gap-1">
                              <ThumbsUp className="h-3 w-3" />
                              {note.likes}
                            </span>
                          </div>
                          <span>{note.author} / {note.updatedAt}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Note Detail */}
              <div className="w-1/2 overflow-y-auto">
                {selectedNote ? (
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <Badge className="mb-2">{selectedNote.category}</Badge>
                        <h2 className="text-xl font-bold">{selectedNote.title}</h2>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1 bg-transparent">
                        <ThumbsUp className="h-4 w-4" />
                        도움됨 ({selectedNote.likes})
                      </Button>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                      <span className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        {selectedNote.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {selectedNote.updatedAt} 수정
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-4 w-4" />
                        {selectedNote.views}회 조회
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mb-6">
                      {selectedNote.tags.map(tag => (
                        <Badge key={tag} variant="secondary">
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <div className="prose prose-sm max-w-none mb-6">
                      <pre className="whitespace-pre-wrap font-sans bg-muted p-4 rounded-lg text-sm">
                        {selectedNote.content}
                      </pre>
                    </div>

                    {selectedNote.linkedInquiries.length > 0 && (
                      <div className="border-t pt-4">
                        <h4 className="font-medium mb-2 flex items-center gap-2">
                          <ExternalLink className="h-4 w-4" />
                          연결된 문의
                        </h4>
                        <div className="flex gap-2">
                          {selectedNote.linkedInquiries.map(inq => (
                            <Button key={inq} variant="outline" size="sm" asChild>
                              <a href={`/inbox/${inq}`}>{inq}</a>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>노트를 선택하세요</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* FAQ Tab */}
          <TabsContent value="faq" className="flex-1 overflow-y-auto m-0 p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {faqItems.map(faq => (
                <Card key={faq.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <HelpCircle className="h-5 w-5 text-primary shrink-0" />
                        {faq.question}
                      </CardTitle>
                      <Badge variant="outline">{faq.category}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      {faq.answer}
                    </pre>
                    <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {faq.views}회 조회
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                        <ThumbsUp className="h-3 w-3" />
                        도움됨
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Product Guides Tab */}
          <TabsContent value="guides" className="flex-1 overflow-y-auto m-0 p-6">
            <div className="max-w-4xl mx-auto">
              <div className="grid gap-6 md:grid-cols-3 mb-8">
                {productGuides.map(guide => (
                  <Card key={guide.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                        <guide.icon className="h-6 w-6" />
                      </div>
                      <CardTitle className="text-lg">{guide.title}</CardTitle>
                      <CardDescription>{guide.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {guide.steps.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Quick Reference */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-5 w-5 text-yellow-500" />
                    빠른 참조 - 소재별 추천 공구
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium">소재</th>
                          <th className="text-left py-2 px-3 font-medium">추천 엔드밀</th>
                          <th className="text-left py-2 px-3 font-medium">추천 코팅</th>
                          <th className="text-left py-2 px-3 font-medium">절삭속도 (Vc)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                          <td className="py-2 px-3">일반강 (S45C)</td>
                          <td className="py-2 px-3">V7 Plus 4F</td>
                          <td className="py-2 px-3">TiAlN</td>
                          <td className="py-2 px-3">100-150 m/min</td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 px-3">스테인리스 (SUS304)</td>
                          <td className="py-2 px-3">I-Xmill 4F</td>
                          <td className="py-2 px-3">TiAlN / AlCrN</td>
                          <td className="py-2 px-3">80-120 m/min</td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 px-3">알루미늄 (AL6061)</td>
                          <td className="py-2 px-3">Alu-Power 3F</td>
                          <td className="py-2 px-3">DLC / 무코팅</td>
                          <td className="py-2 px-3">500-2000 m/min</td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 px-3">금형강 (SKD11)</td>
                          <td className="py-2 px-3">X5070 4F</td>
                          <td className="py-2 px-3">AlCrN</td>
                          <td className="py-2 px-3">60-100 m/min</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-3">인코넬 (718)</td>
                          <td className="py-2 px-3">I-Xmill 4F</td>
                          <td className="py-2 px-3">AlCrN</td>
                          <td className="py-2 px-3">20-40 m/min</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
