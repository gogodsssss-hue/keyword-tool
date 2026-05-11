"""
블로그 SEO 분석기 - 로컬 테스트 서버
실행: python server.py
접속: http://localhost:3000
"""

import json
import os
import hashlib
import hmac
import time
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlencode, quote
from urllib.error import HTTPError

# ── 환경변수에서 키 읽기 ──────────────────────────────────────────
CLAUDE_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")
NAVER_CID     = os.environ.get("NAVER_CLIENT_ID", "")
NAVER_CSEC    = os.environ.get("NAVER_CLIENT_SECRET", "")
AD_KEY        = os.environ.get("NAVER_AD_API_KEY", "")
AD_SECRET     = os.environ.get("NAVER_AD_SECRET_KEY", "")
AD_CUSTOMER   = os.environ.get("NAVER_AD_CUSTOMER_ID", "")

HAS_NAVER = bool(NAVER_CID and NAVER_CSEC)
HAS_ADS   = bool(AD_KEY and AD_SECRET and AD_CUSTOMER)

# ── 네이버 API 헬퍼 ──────────────────────────────────────────────
def naver_headers():
    return {
        "X-Naver-Client-Id": NAVER_CID,
        "X-Naver-Client-Secret": NAVER_CSEC
    }

def naver_blog_search(query):
    if not HAS_NAVER: return None
    try:
        url = f"https://openapi.naver.com/v1/search/blog.json?query={quote(query)}&display=1&sort=sim"
        req = Request(url, headers=naver_headers())
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        return data.get("total")
    except: return None

def naver_datalab(keyword):
    if not HAS_NAVER: return None
    try:
        import datetime
        end   = datetime.date.today().isoformat()
        start = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
        body  = json.dumps({
            "startDate": start, "endDate": end, "timeUnit": "month",
            "keywordGroups": [{"groupName": keyword, "keywords": [keyword]}]
        }).encode()
        req = Request(
            "https://openapi.naver.com/v1/datalab/search",
            data=body,
            headers={**naver_headers(), "Content-Type": "application/json"},
            method="POST"
        )
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        pts = (data.get("results") or [{}])[0].get("data", [])
        if not pts: return None
        recent = pts[-3:]
        avg = sum(p["ratio"] for p in recent) / len(recent)
        return {"avg": round(avg, 1)}
    except: return None

def naver_search_volume(keyword):
    if not HAS_ADS: return None
    try:
        ts  = str(int(time.time() * 1000))
        msg = f"{ts}_GET_/keywordstool"
        sig = base64.b64encode(
            hmac.new(AD_SECRET.encode(), msg.encode(), hashlib.sha256).digest()
        ).decode()
        url = f"https://api.naver.com/keywordstool?hintKeywords={quote(keyword)}&showDetail=1"
        req = Request(url, headers={
            "X-Timestamp": ts,
            "X-API-KEY": AD_KEY,
            "X-Customer": AD_CUSTOMER,
            "X-Signature": sig
        })
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        kw = next((k for k in (data.get("keywordList") or []) if k.get("relKeyword") == keyword),
                  (data.get("keywordList") or [None])[0])
        if not kw: return None
        pc  = int(kw.get("monthlyPcQcCnt") or 0)
        mob = int(kw.get("monthlyMobileQcCnt") or 0)
        return {"pc": pc, "mobile": mob, "total": pc + mob}
    except: return None

def naver_news_search(query):
    if not HAS_NAVER: return None
    try:
        url = f"https://openapi.naver.com/v1/search/news.json?query={quote(query)}&display=15&sort=date"
        req = Request(url, headers=naver_headers())
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        return data.get("items")
    except: return None

def naver_shopping_search(query):
    if not HAS_NAVER: return None
    try:
        url = f"https://openapi.naver.com/v1/search/shop.json?query={quote(query)}&display=1"
        req = Request(url, headers=naver_headers())
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        return data.get("total")
    except: return None

# ── Claude API 호출 ──────────────────────────────────────────────
def call_claude(system, user, max_tokens=2500):
    if not CLAUDE_KEY:
        raise ValueError("ANTHROPIC_API_KEY가 설정되지 않았습니다.")
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}]
    }).encode()
    req = Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": CLAUDE_KEY,
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )
    try:
        with urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except HTTPError as e:
        err = json.loads(e.read())
        raise ValueError(err.get("error", {}).get("message", "Claude API 오류"))
    text = data["content"][0]["text"]
    try:
        return json.loads(text)
    except:
        import re
        m = re.search(r'\{[\s\S]*\}', text)
        if m: return json.loads(m.group())
        raise ValueError("응답 파싱 오류")

def call_claude_chat(system, messages, max_tokens=600):
    if not CLAUDE_KEY:
        raise ValueError("ANTHROPIC_API_KEY가 설정되지 않았습니다.")
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages
    }).encode()
    req = Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": CLAUDE_KEY,
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )
    with urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    return data["content"][0]["text"]

# ── 분석 로직 ────────────────────────────────────────────────────
def analyze(payload):
    mode            = payload.get("mode", "")
    topic           = payload.get("topic", "")
    platform        = payload.get("platform", "둘 다")
    keyword         = payload.get("keyword", "")
    blog_url        = payload.get("blogUrl", "")
    neighbors       = payload.get("neighbors", 0)
    today_visitors  = payload.get("todayVisitors", 0)
    total_visitors  = payload.get("totalVisitors", 0)
    avg_visitors    = payload.get("avgVisitors", 0)
    post_count      = payload.get("postCount", 0)
    is_influencer   = payload.get("isInfluencer", "없음")

    # 키워드 추천
    if mode == "keyword-recommend":
        ctx = ""
        if HAS_NAVER:
            bc = naver_blog_search(topic)
            tr = naver_datalab(topic)
            vl = naver_search_volume(topic) if HAS_ADS else None
            if bc is not None: ctx += f"\n블로그수: {bc:,}개"
            if tr: ctx += f"\n트렌드: {tr['avg']}"
            if vl: ctx += f"\n월검색량: {vl['total']:,} (PC {vl['pc']:,} 모바일 {vl['mobile']:,})"
        result = call_claude(
            f"""한국 블로그 SEO 전문가. 부동산·금융·경제 특화. 순수 JSON만 반환.
{{"mainKeywords":[{{"keyword":"","searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","tip":""}}],
"longtailKeywords":[""],"titleSuggestions":["","",""],
"naverStrategy":{{"summary":"","tips":[""]}},"tistoryStrategy":{{"summary":"","tips":[""]}},
"contentStructure":[""],"dataSource":"{'네이버 실데이터 + Claude AI' if HAS_NAVER else 'Claude AI'}"}}
mainKeywords 5개, longtailKeywords 10개.""",
            f"주제: {topic}\n플랫폼: {platform}{ctx}"
        )
        return {**result, "_hasNaver": HAS_NAVER, "_hasAds": HAS_ADS}

    # 황금 키워드
    elif mode == "golden-keyword":
        cands = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"candidates":["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8","키워드9","키워드10"]}\n부동산·금융·경제 분야 검색량 높고 경쟁 낮을 후보 10개.',
            f"주제: {topic}"
        )
        enriched = []
        for kw in (cands.get("candidates") or []):
            bc = naver_blog_search(kw) if HAS_NAVER else None
            tr = naver_datalab(kw) if HAS_NAVER else None
            vl = naver_search_volume(kw) if HAS_ADS else None
            enriched.append({"keyword": kw, "blogCount": bc, "trendAvg": tr["avg"] if tr else None, "vol": vl["total"] if vl else None})
        enriched.sort(key=lambda x: x["blogCount"] or 999999)
        ctx = "\n".join(f"- {e['keyword']}: 블로그수 {e['blogCount'] or '?'}개, 트렌드 {e['trendAvg'] or '?'}, 월검색량 {e['vol'] or '?'}" for e in enriched)
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"goldenKeywords":[{"keyword":"","searchVolume":"높음|중간|낮음","competition":"낮음|중간","goldenScore":"★~★★★★★","reason":""}],"tips":[""],"dataSource":""}\ngoldenKeywords 8개.',
            f"주제: {topic}\n플랫폼: {platform}\n\n네이버 실데이터:\n{ctx}"
        )
        return {**result, "_hasNaver": HAS_NAVER, "_hasAds": HAS_ADS}

    # 키워드 지수
    elif mode == "keyword-index":
        bc = naver_blog_search(keyword) if HAS_NAVER else None
        tr = naver_datalab(keyword) if HAS_NAVER else None
        vl = naver_search_volume(keyword) if HAS_ADS else None
        ctx = "\n".join(filter(None, [
            f"블로그수: {bc:,}개" if bc is not None else None,
            f"트렌드: {tr['avg']}" if tr else None,
            f"월검색량: {vl['total']:,} (PC {vl['pc']:,} 모바일 {vl['mobile']:,})" if vl else None
        ]))
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","exposure":"높음|중간|낮음","analysis":"","naverTips":[""],"tistoryTips":[""],"dataSource":""}',
            f"키워드: {keyword}\n플랫폼: {platform}\n\n네이버 실데이터:\n{ctx or '없음'}"
        )
        result["naverRawData"] = {"blogCount": bc, "trendAvg": tr["avg"] if tr else None, "monthlySearch": vl["total"] if vl else None, "pc": vl["pc"] if vl else None, "mobile": vl["mobile"] if vl else None}
        return {**result, "_hasNaver": HAS_NAVER, "_hasAds": HAS_ADS}

    # 블로그 누락
    elif mode == "blog-missing":
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"causes":[""],"solutions":[""]}\n누락 원인 5개, 해결방법 5개.',
            f"블로그: {blog_url}\n키워드: {keyword or '없음'}"
        )
        return {**result, "_hasNaver": HAS_NAVER}

    # 블로그 지수
    elif mode == "blog-index":
        # 입력된 현황 수치 조합
        stats_lines = []
        if post_count:    stats_lines.append(f"총 포스팅 수: {post_count:,}개")
        if neighbors:     stats_lines.append(f"이웃수: {neighbors:,}명")
        if today_visitors:stats_lines.append(f"오늘 방문자: {today_visitors:,}명")
        if avg_visitors:  stats_lines.append(f"평균 방문자: {avg_visitors:,}명/일")
        if total_visitors:stats_lines.append(f"전체 방문자: {total_visitors:,}명")
        if is_influencer == "있음": stats_lines.append("인플루언서: YES")
        stats_ctx = "\n".join(stats_lines) if stats_lines else "수치 미입력(URL 기반 추정)"

        result = call_claude(
            '''한국 블로그 SEO 전문가. 부동산·금융·경제 특화. 순수 JSON만 반환.

[키워드마스터 기준 블로그 레벨]
Level 0: 신생(포스팅 0~5개, 방문자 거의 없음)
Level 1: 입문(5~20개, 이웃 100~500명, 전체방문자 ~5만)
Level 2: 초보(20~50개, 이웃 500~1000명, 일방문자 50~100)
Level 3: 성장(50~100개, 이웃 1000~2000명, 일방문자 100~200)
Level 4: 활성(100~200개, 이웃 2000~5000명, 일방문자 200~500)
Level 5: 중급(200~400개, 이웃 5000~1만, 일방문자 500~1000)
Level 6: 숙련(400~700개, 이웃 1만~3만, 일방문자 1000~2000)
Level 7: 고급(700~1000개, 이웃 3만~5만, 일방문자 2000~5000)
Level 8: 전문가(1000~1500개, 인플루언서급, 일방문자 5000+)
Level 9: 파워블로거(1500~2000개, 상위1%)
Level 10: 최고권위(2000개+, 네이버 인플루언서 최상위)

입력된 현황 수치가 있으면 그것을 최우선으로 레벨 판단.
없으면 URL로 추정.

{"estimatedLevel":0,"levelReason":"","scores":[{"label":"콘텐츠 품질","value":"A~F","sub":""},{"label":"업로드 주기","value":"A~F","sub":""},{"label":"이웃/방문자","value":"A~F","sub":""},{"label":"키워드 최적화","value":"A~F","sub":""},{"label":"SEO 구조","value":"A~F","sub":""}],"nextLevelTips":["","",""],"summary":"","tips":[""]}''',
            f"블로그: {blog_url}\n분야: {topic or '부동산/금융/경제'}\n\n[현황 수치]\n{stats_ctx}"
        )
        return {**result, "_hasNaver": HAS_NAVER}

    # 키워드마스터
    elif mode == "km-search":
        bc = naver_blog_search(keyword) if HAS_NAVER else None
        tr = naver_datalab(keyword) if HAS_NAVER else None
        vl = naver_search_volume(keyword) if HAS_ADS else None
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","relatedKeywords":[""],"analysis":"","tips":[""]}\nrelatedKeywords 10개, tips 4개.',
            f"키워드: {keyword}\n블로그수: {bc or '?'}\n트렌드: {tr['avg'] if tr else '?'}\n월검색량: {vl['total'] if vl else '?'}"
        )
        result["rawData"] = {"blogCount": bc, "trendAvg": tr["avg"] if tr else None, "monthlySearch": vl["total"] if vl else None, "pc": vl["pc"] if vl else None, "mobile": vl["mobile"] if vl else None}
        return {**result, "_hasNaver": HAS_NAVER, "_hasAds": HAS_ADS}

    # 형태소 분석기
    elif mode == "km-morpheme":
        result = call_claude(
            '한국어 형태소 분석 전문가. 순수 JSON만 반환.\n{"morphemes":[{"word":"","pos":"명사|동사|형용사|부사","count":0}],"topKeywords":[""],"sentiment":"긍정|부정|중립","sentimentScore":0.0,"sentimentDetail":"","summary":""}\nmorphemes 최대 30개 빈도순. topKeywords 10개.',
            f"분석할 텍스트:\n{keyword}",
            3000
        )
        return result

    # 셀러마스터
    elif mode == "km-seller":
        pc = naver_shopping_search(keyword) if HAS_NAVER else None
        result = call_claude(
            '한국 온라인 쇼핑 셀러 전문가. 순수 JSON만 반환.\n{"competition":"높음|중간|낮음","priceRange":{"min":0,"max":0,"avg":0},"sellerTips":[""],"relatedProducts":[""],"analysis":""}\nsellerTips 5개, relatedProducts 5개.',
            f"상품: {keyword}\n네이버쇼핑 상품수: {f'{pc:,}개' if pc else '알 수 없음'}"
        )
        result["productCount"] = pc
        return {**result, "_hasNaver": HAS_NAVER}

    # 실시간 검색어
    elif mode == "km-realtime":
        import datetime
        today = datetime.date.today().isoformat()
        cat_map = {"부동산": "부동산 아파트 전세", "금융/경제": "경제 금융 주식", "재테크/투자": "재테크 투자 ETF", "뉴스/이슈": "이슈 사건", "전체": "주요뉴스"}
        query = cat_map.get(topic, "주요뉴스")
        news  = naver_news_search(query) if HAS_NAVER else None
        if news:
            import re
            def strip(s): return re.sub(r'<[^>]+>', '', s or '').strip()
            news_txt = "\n".join(f"{i+1}. {strip(n['title'])} / {strip(n['description'])[:60]}" for i, n in enumerate(news[:12]))
            result = call_claude(
                '한국 뉴스 트렌드 분석가. 순수 JSON만 반환.\n{"keywords":[{"rank":1,"keyword":"핵심검색어(5글자이내)","category":"분야","trend":"상승|신규|유지","desc":"뉴스한줄요약(25자이내)","headline":"원본뉴스제목"}],"summary":"오늘트렌드한줄요약"}\nkeywords 10개.',
                f"분야: {topic}\n날짜: {today}\n\n최신뉴스:\n{news_txt}"
            )
            result["_hasRealNews"] = True
        else:
            result = call_claude(
                '한국 트렌드 분석 전문가. 순수 JSON만 반환.\n{"keywords":[{"rank":1,"keyword":"","category":"","trend":"상승|신규|유지","desc":""}],"summary":""}\nkeywords 10개.',
                f"분야: {topic or '전체'}\n날짜: {today}"
            )
            result["_hasRealNews"] = False
        result["updatedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return result

    # 유튜브 분석기
    elif mode == "youtube-analyze":
        result = call_claude(
            '''한국 유튜브 SEO 전문가. 순수 JSON만 반환.
{"channelAnalysis":{"level":"신규|성장|중급|전문가|파워채널","reason":""},"keywordAnalysis":{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","trending":"상승|유지|하락"},"titleSuggestions":["","",""],"recommendedTags":["","","","","","","","","",""],"thumbnailTips":["","",""],"growthStrategy":["","","","",""],"summary":""}''',
            f"분석대상: {keyword}\n분야: {topic or '부동산/금융/경제'}"
        )
        return result

    # 블로그 매트릭스
    elif mode == "blog-matrix":
        bc = naver_blog_search(keyword) if HAS_NAVER else None
        tr = naver_datalab(keyword) if HAS_NAVER else None
        vl = naver_search_volume(keyword) if HAS_ADS else None
        result = call_claude(
            '''한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"blogLevel":{"level":0,"reason":""},"keywordStatus":{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","opportunity":"높음|중간|낮음"},"goldenKeywords":[{"keyword":"","score":"★~★★★★★","reason":""}],"competitionMatrix":[{"competitor":"","strength":"","weakness":""}],"contentPlan":[""],"quickWins":[""],"summary":""}
goldenKeywords 3개, competitionMatrix 3개, contentPlan 4개, quickWins 4개.''',
            f"블로그: {blog_url}\n키워드: {keyword}\n플랫폼: {platform}\n블로그수: {bc or '?'}\n트렌드: {tr['avg'] if tr else '?'}\n월검색량: {vl['total'] if vl else '?'}"
        )
        return {**result, "_hasNaver": HAS_NAVER}

    # 무한 키워드
    elif mode == "infinite-keyword":
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"keywords":[{"keyword":"","type":"메인|세부|롱테일","searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음"}],"totalCount":50,"summary":""}\n메인 10개+세부 20개+롱테일 20개=50개.',
            f"주제: {topic}\n플랫폼: {platform}"
        )
        return result

    # 세부키워드 조합기
    elif mode == "keyword-combiner":
        result = call_claude(
            '한국 블로그 SEO 전문가. 순수 JSON만 반환.\n{"comma":"","space":"","hashtag":"","naverTag":"","recommended":["","","","",""],"totalCount":0}\n4가지 형식 변환 + 추천조합 5개.',
            f"키워드 목록:\n{keyword}"
        )
        return result

    # 대화형 챗
    elif mode == "chat":
        msgs = payload.get("messages", [])
        ctx  = payload.get("blogContext", {})
        stats_parts = list(filter(None, [
            f"포스팅 수: {ctx.get('postCount')}개"       if ctx.get('postCount')     else "",
            f"이웃수: {ctx.get('neighbors')}명"           if ctx.get('neighbors')     else "",
            f"오늘 방문자: {ctx.get('todayVisitors')}명"  if ctx.get('todayVisitors') else "",
            f"평균 방문자: {ctx.get('avgVisitors')}명/일" if ctx.get('avgVisitors')   else "",
            f"전체 방문자: {ctx.get('totalVisitors')}명"  if ctx.get('totalVisitors') else "",
            "인플루언서: YES" if ctx.get('isInfluencer') == "있음" else ""
        ]))
        stats_str = " / ".join(stats_parts) if stats_parts else "미입력"
        system = f"""당신은 한국 블로그 SEO 전문 코치입니다. 부동산·금융·경제 분야 블로그 특화.

[분석된 블로그 정보]
- 주소: {ctx.get('blogUrl','미입력')}
- 분야: {ctx.get('topic','부동산/금융/경제')}
- 현재 레벨: Level {ctx.get('estimatedLevel','?')} / 10
- 레벨 근거: {ctx.get('levelReason','')}
- 현황 수치: {stats_str}
- 분석 요약: {ctx.get('summary','')}
- 다음 레벨 조건: {' / '.join(ctx.get('nextLevelTips',[]))}

[대화 원칙]
1. 짧고 명확하게. 3~5문장 이내.
2. 구체적 숫자·행동 지침 제시.
3. 부동산·금융·경제 블로그 특성 반영.
4. 블로그 분석을 안 했어도 일반 SEO 질문에 답변 가능.
5. 정직한 선배처럼 솔직하게.
6. 마지막에 다음 질문 유도 한마디.

JSON 없이 자연스러운 한국어 대화체로 답하세요."""
        reply = call_claude_chat(system, msgs)
        return {"reply": reply}

    else:
        raise ValueError(f"지원하지 않는 모드: {mode}")


# ── HTTP 핸들러 ──────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            try:
                with open("index.html", "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_json(404, {"error": "index.html 없음"})
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/analyze":
            self.send_json(404, {"error": "Not found"})
            return
        length  = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length))
        try:
            result = analyze(payload)
            self.send_json(200, result)
        except Exception as e:
            self.send_json(500, {"error": str(e)})


# ── 실행 ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not CLAUDE_KEY:
        print("⚠️  ANTHROPIC_API_KEY 환경변수가 없습니다.")
        print("   set ANTHROPIC_API_KEY=sk-ant-...")
        print()

    print("=" * 50)
    print("  블로그 SEO 분석기 로컬 서버")
    print("=" * 50)
    print(f"  Claude API  : {'✅ 연결됨' if CLAUDE_KEY else '❌ 키 없음'}")
    print(f"  네이버 API  : {'✅ 연결됨' if HAS_NAVER else '❌ 키 없음'}")
    print(f"  네이버 광고 : {'✅ 연결됨' if HAS_ADS else '❌ 키 없음'}")
    print()
    print("  접속 주소 → http://localhost:3000")
    print("  종료: Ctrl+C")
    print("=" * 50)

    server = HTTPServer(("", 3000), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
