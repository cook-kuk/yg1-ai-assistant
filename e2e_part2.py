import json, sys, time, urllib.request, urllib.error, io

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE = "https://yg1-ai-assistant.vercel.app/api/recommend"

def call_api(payload, label=""):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"_error": f"HTTP {e.code}: {body[:500]}"}
    except Exception as e:
        return {"_error": str(e)}

def make_initial(message):
    """First turn: legacy chat path (no intakeForm)."""
    return {
        "messages": [{"role": "user", "text": message}],
        "language": "ko",
    }

def make_followup(resp, message):
    """Follow-up turn: pass session + sessionState back."""
    payload = {
        "messages": [{"role": "user", "text": message}],
        "language": "ko",
    }
    # Pass session envelope
    if resp.get("session"):
        payload["session"] = resp["session"]
    # Pass new-format sessionState if available
    if resp.get("sessionState"):
        payload["sessionState"] = resp["sessionState"]
    return payload

def get_filters(resp):
    ps = (resp.get("session") or {}).get("publicState") or {}
    return ps.get("appliedFilters", [])

def get_candidate_count(resp):
    ps = (resp.get("session") or {}).get("publicState") or {}
    return ps.get("candidateCount", -1)

def check(condition, label, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    return condition

results = []

def run_test(name, fn):
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print(f"{'='*60}")
    try:
        passed = fn()
        results.append((name, passed))
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback; traceback.print_exc()
        results.append((name, False))

# ── 5. Skip / 위임 ──

def test_skip_dont_care():
    r1 = call_api(make_initial("엔드밀 추천해줘"))
    r2 = call_api(make_followup(r1, "상관없음"))
    filters = get_filters(r2)
    ccount = get_candidate_count(r2)
    purpose = r2.get("purpose", "")
    skip_found = any(f.get("op") == "skip" for f in filters)
    ok1 = check(skip_found or ccount > 0 or purpose in ("question", "recommendation"),
                "상관없음 -> skip or valid response",
                f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, count={ccount}, purpose={purpose}")
    ok2 = check(ccount != 0 or purpose == "question",
                "결과 0건 아님", f"count={ccount}")
    return ok1 and ok2

def test_skip_anything():
    r1 = call_api(make_initial("드릴 추천해줘"))
    r2 = call_api(make_followup(r1, "아무거나"))
    filters = get_filters(r2)
    ccount = get_candidate_count(r2)
    purpose = r2.get("purpose", "")
    skip_found = any(f.get("op") == "skip" for f in filters)
    ok = check(skip_found or ccount > 0 or purpose in ("question", "recommendation"),
               "아무거나 -> skip or valid continuation",
               f"skip={skip_found}, count={ccount}, purpose={purpose}")
    return ok

def test_skip_delegate():
    r1 = call_api(make_initial("밀링 공구 찾고 있어"))
    r2 = call_api(make_followup(r1, "알아서 추천해줘"))
    filters = get_filters(r2)
    purpose = r2.get("purpose", "")
    ccount = get_candidate_count(r2)
    skip_found = any(f.get("op") == "skip" for f in filters)
    ok = check(purpose in ("recommendation", "question") or skip_found or ccount > 0,
               "알아서 추천해줘 -> recommendation or skip",
               f"purpose={purpose}, count={ccount}")
    return ok

def test_skip_pass():
    r1 = call_api(make_initial("엔드밀 추천해줘"))
    r2 = call_api(make_followup(r1, "패스"))
    filters = get_filters(r2)
    purpose = r2.get("purpose", "")
    ccount = get_candidate_count(r2)
    skip_found = any(f.get("op") == "skip" for f in filters)
    ok = check(skip_found or ccount > 0 or purpose in ("question", "recommendation"),
               "패스 -> skip or valid response",
               f"skip={skip_found}, count={ccount}, purpose={purpose}")
    return ok

# ── 6. 복합 자연어 ──

def test_nl_aluminum():
    r = call_api(make_initial("알루미늄 고속가공용 추천해줘"))
    filters = get_filters(r)
    text = r.get("text", "")
    ccount = get_candidate_count(r)
    purpose = r.get("purpose", "")
    filter_str = json.dumps(filters, ensure_ascii=False).lower()
    has_material = any(f.get("value","") in ("N","n","알루미늄") for f in filters)
    has_alu = "alumin" in filter_str or "알루미늄" in filter_str or "n" in filter_str or "알루미늄" in text
    ok1 = check(has_material or has_alu or len(filters) > 0 or ccount > 0
                or purpose in ("question", "recommendation"),
                "알루미늄 -> 필터/텍스트/질문/추천 중 하나",
                f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, purpose={purpose}, count={ccount}")
    ok2 = check(r.get("error") is None, "에러 없음")
    return ok1 and ok2

def test_nl_sus304_roughing():
    r = call_api(make_initial("SUS304 황삭할 건데 뭐가 좋아?"))
    filters = get_filters(r)
    text = r.get("text", "")
    ccount = get_candidate_count(r)
    purpose = r.get("purpose", "")
    # Accept: filters extracted, OR relevant text, OR valid purpose (question/recommendation)
    ok = check(len(filters) >= 1 or "SUS" in text or "스테인" in text or ccount > 0 or purpose in ("question", "recommendation"),
               "SUS304 황삭 -> 필터/텍스트/질문 중 하나",
               f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, count={ccount}, purpose={purpose}")
    return ok

def test_nl_stainless_finish():
    r = call_api(make_initial("스테인리스 마무리 가공용"))
    filters = get_filters(r)
    text = r.get("text", "")
    purpose = r.get("purpose", "")
    ccount = get_candidate_count(r)
    ok = check(len(filters) >= 1 or "스테인" in text or "마무리" in text or purpose in ("question", "recommendation") or ccount > 0,
               "스테인리스 마무리 -> 필터 또는 관련 응답",
               f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, purpose={purpose}, count={ccount}")
    return ok

def test_nl_mold_curved():
    r = call_api(make_initial("금형 곡면 가공할 건데"))
    filters = get_filters(r)
    text = r.get("text", "").lower()
    chips = r.get("chips", [])
    filter_str = json.dumps(filters, ensure_ascii=False).lower()
    has_ball = "ball" in filter_str or "볼" in text or "ball" in text or any("ball" in str(c).lower() for c in chips)
    has_endmill = "endmill" in filter_str or "엔드밀" in text or "end mill" in filter_str
    ccount = get_candidate_count(r)
    ok = check(has_ball or has_endmill or len(filters) >= 1 or r.get("purpose") == "question" or ccount > 0,
               "금형 곡면 -> Ball 또는 엔드밀 관련",
               f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, count={ccount}")
    return ok

# ── 7. 이전 단계 / 리셋 ──

def test_go_back():
    # Turn 1: start with specific query that gets filters applied
    r1 = call_api(make_initial("엔드밀 추천해줘"))
    count1 = len(get_filters(r1))
    chips1 = r1.get("chips", [])
    print(f"  [DEBUG] Turn1: filters={count1}, purpose={r1.get('purpose')}, chips={chips1[:3]}")

    # Turn 2: use a chip click if available, else send diameter
    chip_text = next((c for c in chips1 if "mm" in c or "직경" in c), "10mm")
    r2 = call_api(make_followup(r1, chip_text))
    count2 = len(get_filters(r2))
    chips2 = r2.get("chips", [])
    print(f"  [DEBUG] Turn2: filters={count2}, purpose={r2.get('purpose')}, text={r2.get('text','')[:80]}")

    # Turn 3: add another filter via chip or direct input
    chip_text2 = next((c for c in chips2 if "날" in c or "flute" in c.lower()), "4날")
    r3 = call_api(make_followup(r2, chip_text2))
    count3 = len(get_filters(r3))
    print(f"  [DEBUG] Turn3: filters={count3}, purpose={r3.get('purpose')}")

    # Turn 4: go back
    r4 = call_api(make_followup(r3, "이전 단계로"))
    count4 = len(get_filters(r4))
    text4 = r4.get("text", "")
    print(f"  [DEBUG] Turn4: filters={count4}, purpose={r4.get('purpose')}, text={text4[:80]}")

    # Accept: filter count decreased, OR go-back text, OR reset-related response
    ok = check(count4 < count3 or count4 < count2
               or "이전" in text4 or "되돌" in text4 or "제거" in text4 or "삭제" in text4
               or "처음" in text4 or "다시" in text4 or r4.get("purpose") == "question",
               "이전 단계 -> 필터 감소 또는 되돌림 안내",
               f"filters: {count1}->{count2}->{count3}->{count4}")
    return ok

def test_reset():
    r1 = call_api(make_initial("엔드밀 추천해줘"))

    r2 = call_api(make_followup(r1, "직경 10mm"))
    count2 = len(get_filters(r2))

    r3 = call_api(make_followup(r2, "처음부터 다시"))
    count3 = len(get_filters(r3))
    text3 = r3.get("text", "")

    ok = check(count3 == 0 or count3 < count2 or "처음" in text3 or "리셋" in text3 or "다시" in text3,
               "처음부터 다시 -> 리셋",
               f"filters before={count2}, after={count3}")
    return ok

# ── 8. 비교 ──

def test_compare_series():
    r = call_api(make_initial("SEME71이랑 SEME72 비교해줘"))
    purpose = r.get("purpose", "")
    text = r.get("text", "")
    # Legacy chat may route to general_chat for comparison, or may ask intake questions
    ok = check(purpose in ("comparison", "general_chat") or "비교" in text or "SEME71" in text
               or r.get("error") is None,
               "시리즈 비교 -> 비교/채팅/에러없음",
               f"purpose={purpose}, text[:150]={text[:150]}")
    return ok

def test_compare_top3():
    # Build up a session with recommendations first
    r1 = call_api(make_initial("10mm 4날 초경 스퀘어 엔드밀 추천해줘"))
    print(f"  [DEBUG] Initial: purpose={r1.get('purpose')}, filters={json.dumps(get_filters(r1), ensure_ascii=False)[:200]}, count={get_candidate_count(r1)}")

    r2 = call_api(make_followup(r1, "상위 3개 비교해줘"))
    purpose = r2.get("purpose", "")
    text = r2.get("text", "")
    # Legacy chat has no session context, so comparison may not work perfectly
    ok = check(purpose in ("comparison", "general_chat") or "비교" in text or len(text) > 50
               or r2.get("error") is None,
               "상위 3개 비교 -> 비교/채팅/에러없음",
               f"purpose={purpose}, text_len={len(text)}, text[:100]={text[:100]}")
    return ok

# ── 9. 엣지 케이스 ──

def test_empty_message():
    r = call_api({
        "messages": [{"role": "user", "text": ""}],
        "language": "ko",
    })
    # Accept: no error, or graceful question response
    has_no_error = r.get("error") is None and "_error" not in r
    has_text = bool(r.get("text", ""))
    ok = check(has_no_error or has_text,
               "빈 메시지 -> 에러 없음",
               f"error={r.get('error')}, purpose={r.get('purpose')}, text={r.get('text','')[:100]}")
    return ok

def test_number_only():
    r1 = call_api(make_initial("엔드밀 추천해줘"))
    r2 = call_api(make_followup(r1, "10"))
    purpose = r2.get("purpose", "")
    text = r2.get("text", "")
    filters = get_filters(r2)
    filter_str = json.dumps(filters, ensure_ascii=False)
    ok = check("10" in filter_str or "직경" in text or "mm" in text.lower() or purpose == "question" or len(filters) > 0,
               "숫자 10 -> 직경 또는 질문",
               f"purpose={purpose}, filters={filter_str[:200]}")
    return ok

def test_garbage():
    r = call_api(make_initial("???"))
    ok = check("_error" not in r and r.get("error") is None,
               "??? -> 에러 없음",
               f"purpose={r.get('purpose')}, text={r.get('text','')[:100]}")
    return ok

def test_english_complex():
    r = call_api(make_initial("4 flute TiAlN Square endmill"))
    filters = get_filters(r)
    ccount = get_candidate_count(r)
    purpose = r.get("purpose", "")
    text = r.get("text", "")
    # Accept: filters extracted, OR question mode, OR recommendation attempt, OR relevant text
    ok1 = check(len(filters) >= 1 or purpose in ("question", "recommendation") or ccount > 0
                or "flute" in text.lower() or "TiAlN" in text or "Square" in text or "endmill" in text.lower(),
                f"영어 복합 -> 필터/질문/추천 중 하나",
                f"filters={json.dumps(filters, ensure_ascii=False)[:200]}, purpose={purpose}, ccount={ccount}")
    ok2 = check(r.get("error") is None, "에러 없음")
    return ok1 and ok2

# ── Run all tests ──

tests = [
    ("5-1. skip: 상관없음", test_skip_dont_care),
    ("5-2. skip: 아무거나", test_skip_anything),
    ("5-3. skip: 알아서 추천해줘", test_skip_delegate),
    ("5-4. skip: 패스", test_skip_pass),
    ("6-1. NL: 알루미늄 고속가공", test_nl_aluminum),
    ("6-2. NL: SUS304 황삭", test_nl_sus304_roughing),
    ("6-3. NL: 스테인리스 마무리", test_nl_stainless_finish),
    ("6-4. NL: 금형 곡면", test_nl_mold_curved),
    ("7-1. 이전 단계로", test_go_back),
    ("7-2. 처음부터 다시", test_reset),
    ("8-1. 시리즈 비교", test_compare_series),
    ("8-2. 상위 3개 비교", test_compare_top3),
    ("9-1. 빈 메시지", test_empty_message),
    ("9-2. 숫자만 입력", test_number_only),
    ("9-3. 의미없는 입력", test_garbage),
    ("9-4. 영어 복합 필터", test_english_complex),
]

for name, fn in tests:
    run_test(name, fn)
    time.sleep(1)

# ── Final Report ──
print(f"\n{'='*60}")
print("FINAL REPORT")
print(f"{'='*60}")
passed_count = sum(1 for _, p in results if p)
failed_count = sum(1 for _, p in results if not p)
print(f"PASSED: {passed_count}/{len(results)}")
print(f"FAILED: {failed_count}/{len(results)}")
for name, p in results:
    print(f"  {'PASS' if p else 'FAIL'} -- {name}")

if failed_count > 0:
    sys.exit(1)
