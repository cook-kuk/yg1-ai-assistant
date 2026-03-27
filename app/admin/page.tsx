"use client"

import { useState } from "react"
import {
  Settings,
  Database,
  Shield,
  BarChart3,
  Users,
  Bell,
  Save,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Clock,
  FileText,
  RefreshCw
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { FeedbackAnalytics } from "@/components/admin/feedback-analytics"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts"

// Mock data for schema fields
const fieldSchemas = [
  { id: 1, category: "엔드밀", fields: ["피삭재", "가공방식", "직경", "날수", "코팅"], required: ["피삭재", "직경"] },
  { id: 2, category: "드릴", fields: ["피삭재", "홀직경", "홀깊이", "코팅"], required: ["피삭재", "홀직경"] },
  { id: 3, category: "탭", fields: ["피삭재", "나사규격", "피치", "코팅"], required: ["나사규격", "피치"] },
  { id: 4, category: "인서트", fields: ["피삭재", "형번", "코팅", "브레이커"], required: ["형번"] },
]

// Mock guardrail rules
const guardrailRules = [
  { id: 1, name: "수출 제한 국가", type: "block", condition: "country IN ['북한', '이란', '시리아']", active: true },
  { id: 2, name: "군사용 문의 플래그", type: "flag", condition: "industry CONTAINS '방산' OR '군수'", active: true },
  { id: 3, name: "대량 주문 알림", type: "alert", condition: "quantity > 1000", active: true },
  { id: 4, name: "경쟁사 언급 플래그", type: "flag", condition: "content CONTAINS competitor_names", active: true },
  { id: 5, name: "가격 할인 요청", type: "alert", condition: "content CONTAINS '할인' OR '특가'", active: false },
]

// Mock quality monitoring data
const qualityTrendData = [
  { date: "1월", accuracy: 78, confidence: 72, approval: 85 },
  { date: "2월", accuracy: 82, confidence: 75, approval: 88 },
  { date: "3월", accuracy: 85, confidence: 78, approval: 90 },
  { date: "4월", accuracy: 83, confidence: 80, approval: 87 },
  { date: "5월", accuracy: 88, confidence: 82, approval: 92 },
  { date: "6월", accuracy: 91, confidence: 85, approval: 94 },
]

const feedbackData = [
  { name: "Won", value: 45, color: "#22c55e" },
  { name: "Lost", value: 25, color: "#ef4444" },
  { name: "Pending", value: 30, color: "#f59e0b" },
]

const lossReasons = [
  { reason: "가격 경쟁력 부족", count: 12, trend: "up" },
  { reason: "납기 불일치", count: 8, trend: "down" },
  { reason: "스펙 미충족", count: 5, trend: "same" },
  { reason: "경쟁사 선택", count: 7, trend: "up" },
  { reason: "프로젝트 취소", count: 3, trend: "down" },
]

export default function AdminPage() {
  const { toast } = useToast()
  const [schemas, setSchemas] = useState(fieldSchemas)
  const [rules, setRules] = useState(guardrailRules)
  const [selectedSchema, setSelectedSchema] = useState<typeof fieldSchemas[0] | null>(null)
  const [showFeedbackAnalytics, setShowFeedbackAnalytics] = useState(false)
  const [isSchemaDialogOpen, setIsSchemaDialogOpen] = useState(false)
  const [newField, setNewField] = useState("")

  const handleSaveSchema = () => {
    toast({
      title: "스키마 저장됨",
      description: "필드 스키마가 성공적으로 업데이트되었습니다."
    })
    setIsSchemaDialogOpen(false)
  }

  const handleToggleRule = (ruleId: number) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, active: !r.active } : r
    ))
    toast({
      title: "규칙 업데이트",
      description: "가드레일 규칙이 변경되었습니다."
    })
  }

  const handleRecordFeedback = (result: "won" | "lost") => {
    toast({
      title: result === "won" ? "수주 기록됨" : "실주 기록됨",
      description: "피드백이 저장되었습니다. 추천 품질 향상에 활용됩니다."
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">관리</h1>
            <p className="text-muted-foreground text-sm">Admin Settings</p>
          </div>
          <Button>
            <Save className="h-4 w-4 mr-2" />
            전체 저장
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="schema" className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="schema" className="gap-2">
              <Database className="h-4 w-4" />
              필드 스키마
            </TabsTrigger>
            <TabsTrigger value="guardrails" className="gap-2">
              <Shield className="h-4 w-4" />
              가드레일
            </TabsTrigger>
            <TabsTrigger value="quality" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              품질 모니터링
            </TabsTrigger>
            <TabsTrigger value="feedback" className="gap-2">
              <Target className="h-4 w-4" />
              피드백 루프
            </TabsTrigger>
          </TabsList>

          {/* Field Schema Tab */}
          <TabsContent value="schema" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  데이터 필드 스키마
                </CardTitle>
                <CardDescription>
                  공구 카테고리별 필수 입력 필드를 관리합니다. 문의 접수 시 누락 필드 체크에 사용됩니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>카테고리</TableHead>
                      <TableHead>전체 필드</TableHead>
                      <TableHead>필수 필드</TableHead>
                      <TableHead className="text-right">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schemas.map((schema) => (
                      <TableRow key={schema.id}>
                        <TableCell className="font-medium">{schema.category}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {schema.fields.map(f => (
                              <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {schema.required.map(f => (
                              <Badge key={f} className="text-xs bg-red-100 text-red-800">{f}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                              setSelectedSchema(schema)
                              setIsSchemaDialogOpen(true)
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="mt-4">
                  <Button variant="outline" className="gap-2 bg-transparent">
                    <Plus className="h-4 w-4" />
                    카테고리 추가
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Guardrails Tab */}
          <TabsContent value="guardrails" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  가드레일 규칙
                </CardTitle>
                <CardDescription>
                  문의 처리 시 자동으로 적용되는 안전 규칙입니다. 수출 제한, 위험 요청 감지 등을 관리합니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {rules.map((rule) => (
                    <Card key={rule.id} className={!rule.active ? "opacity-60" : ""}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <Switch
                              checked={rule.active}
                              onCheckedChange={() => handleToggleRule(rule.id)}
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{rule.name}</span>
                                <Badge variant={
                                  rule.type === "block" ? "destructive" :
                                  rule.type === "flag" ? "secondary" : "outline"
                                }>
                                  {rule.type === "block" ? "차단" : rule.type === "flag" ? "플래그" : "알림"}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground font-mono mt-1">
                                {rule.condition}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <Button variant="outline" className="w-full gap-2 bg-transparent">
                    <Plus className="h-4 w-4" />
                    새 규칙 추가
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quality Monitoring Tab */}
          <TabsContent value="quality" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">추천 정확도</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">91%</span>
                    <span className="text-sm text-green-600 flex items-center">
                      <TrendingUp className="h-4 w-4 mr-1" />
                      +3%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">최근 30일 기준</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">평균 신뢰도</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">85%</span>
                    <span className="text-sm text-green-600 flex items-center">
                      <TrendingUp className="h-4 w-4 mr-1" />
                      +5%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">AI 추천 평균</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">전문가 승인율</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">94%</span>
                    <span className="text-sm text-green-600 flex items-center">
                      <TrendingUp className="h-4 w-4 mr-1" />
                      +2%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">이관 케이스 기준</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>추천 품질 추이</CardTitle>
                <CardDescription>월별 추천 정확도, 신뢰도, 승인율 변화</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    accuracy: { label: "정확도", color: "hsl(var(--chart-1))" },
                    confidence: { label: "신뢰도", color: "hsl(var(--chart-2))" },
                    approval: { label: "승인율", color: "hsl(var(--chart-3))" },
                  }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={qualityTrendData}>
                      <XAxis dataKey="date" />
                      <YAxis domain={[60, 100]} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="accuracy" stroke="var(--color-accuracy)" fill="var(--color-accuracy)" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="confidence" stroke="var(--color-confidence)" fill="var(--color-confidence)" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="approval" stroke="var(--color-approval)" fill="var(--color-approval)" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Feedback Loop Tab */}
          <TabsContent value="feedback" className="space-y-6">
            {showFeedbackAnalytics ? (
              <FeedbackAnalytics onBack={() => setShowFeedbackAnalytics(false)} />
            ) : (
            <>
            <div className="flex justify-end">
              <Button onClick={() => setShowFeedbackAnalytics(true)} className="gap-2">
                <BarChart3 className="h-4 w-4" />
                피드백 분석 보기
              </Button>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>견적 결과 분포</CardTitle>
                  <CardDescription>최근 100건 기준</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      won: { label: "수주", color: "#22c55e" },
                      lost: { label: "실주", color: "#ef4444" },
                      pending: { label: "진행중", color: "#f59e0b" },
                    }}
                    className="h-[250px]"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={feedbackData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}%`}
                        >
                          {feedbackData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartContainer>

                  <div className="flex justify-center gap-6 mt-4">
                    {feedbackData.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-sm">{item.name === "Won" ? "수주" : item.name === "Lost" ? "실주" : "진행중"}</span>
                        <span className="text-sm font-medium">{item.value}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>실주 사유 분석</CardTitle>
                  <CardDescription>개선 포인트 파악</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {lossReasons.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl font-bold text-muted-foreground w-8">{idx + 1}</span>
                          <div>
                            <p className="font-medium">{item.reason}</p>
                            <p className="text-sm text-muted-foreground">{item.count}건</p>
                          </div>
                        </div>
                        <div className={`flex items-center gap-1 text-sm ${
                          item.trend === "up" ? "text-red-600" : 
                          item.trend === "down" ? "text-green-600" : "text-muted-foreground"
                        }`}>
                          {item.trend === "up" && <TrendingUp className="h-4 w-4" />}
                          {item.trend === "down" && <TrendingDown className="h-4 w-4" />}
                          {item.trend === "same" && <Activity className="h-4 w-4" />}
                          {item.trend === "up" ? "증가" : item.trend === "down" ? "감소" : "유지"}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>견적 결과 입력</CardTitle>
                <CardDescription>견적 발송 후 결과를 기록하여 AI 추천 품질 향상에 기여합니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>견적 ID</Label>
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="견적 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="q001">QT-2024-001 - 한국정밀가공</SelectItem>
                          <SelectItem value="q002">QT-2024-002 - 대한금형</SelectItem>
                          <SelectItem value="q003">QT-2024-003 - 삼성전자 협력사</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>결과</Label>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          className="flex-1 border-green-300 text-green-700 hover:bg-green-50 bg-transparent"
                          onClick={() => handleRecordFeedback("won")}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          수주 (Won)
                        </Button>
                        <Button 
                          variant="outline" 
                          className="flex-1 border-red-300 text-red-700 hover:bg-red-50 bg-transparent"
                          onClick={() => handleRecordFeedback("lost")}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          실주 (Lost)
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>사유 / 피드백 (선택)</Label>
                    <Textarea placeholder="수주/실주 사유나 고객 피드백을 입력하세요. AI 학습에 활용됩니다." />
                  </div>

                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      피드백 데이터는 주간 단위로 AI 모델에 반영됩니다. 마지막 업데이트: 2024-01-15
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Schema Edit Dialog */}
      <Dialog open={isSchemaDialogOpen} onOpenChange={setIsSchemaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>필드 스키마 편집</DialogTitle>
            <DialogDescription>
              {selectedSchema?.category} 카테고리의 필드를 편집합니다.
            </DialogDescription>
          </DialogHeader>

          {selectedSchema && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>전체 필드</Label>
                <div className="flex flex-wrap gap-2">
                  {selectedSchema.fields.map(field => (
                    <Badge key={field} variant="outline" className="gap-1">
                      {field}
                      <button className="ml-1 hover:text-red-600">
                        <XCircle className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input 
                    placeholder="새 필드 이름" 
                    value={newField}
                    onChange={(e) => setNewField(e.target.value)}
                  />
                  <Button variant="outline" size="icon">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>필수 필드 지정</Label>
                <div className="space-y-2">
                  {selectedSchema.fields.map(field => (
                    <div key={field} className="flex items-center gap-2">
                      <Switch checked={selectedSchema.required.includes(field)} />
                      <span>{field}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSchemaDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSaveSchema}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
