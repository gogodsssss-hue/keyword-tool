import crypto from 'crypto';

// ── 네이버 API 헬퍼 ──────────────────────────────────────────

// 네이버 블로그 검색 (경쟁도 측정)
async function naverBlogSearch(query, cid, csec) {
  if (!cid || !csec) return null;
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=1&sort=sim`,
      { headers: { 'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': csec } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d.total ?? null;
  } catch { return null; }
}

// 네이버 블로그 검색 — 실제 결과 목록 반환 (순위 체커용)
async function naverBlogSearchItems(query, cid, csec, display = 30) {
  if (!cid || !csec) return null;
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`,
      { headers: { 'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': csec } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return { total: d.total ?? 0, items: d.items ?? [] };
  } catch { return null; }
}

// 네이버 데이터랩 (검색 트렌드)
async function naverDataLab(keyword, cid, csec) {
  if (!cid || !csec) return null;
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': cid,
        'X-Naver-Client-Secret': csec,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate: start, endDate: end, timeUnit: 'month',
        keywordGroups: [{ groupName: keyword, keywords: [keyword] }]
      })
    });
    if (!res.ok) return null;
    const d = await res.json();
    const pts = d.results?.[0]?.data;
    if (!pts?.length) return null;
    const recent = pts.slice(-3);
    const avg = recent.reduce((s, p) => s + p.ratio, 0) / recent.length;
    return { avg: Math.round(avg * 10) / 10, points: pts.slice(-6) };
  } catch { return null; }
}

// 네이버 검색광고 API (실제 월간 검색량)
async function naverSearchVolume(keyword, apiKey, secretKey, customerId) {
  if (!apiKey || !secretKey || !customerId) return null;
  try {
    const ts  = Date.now().toString();
    const sig = crypto.createHmac('sha256', secretKey)
                      .update(`${ts}_GET_/keywordstool`)
                      .digest('base64');
    const res = await fetch(
      `https://api.naver.com/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`,
      {
        headers: {
          'X-Timestamp': ts,
          'X-API-KEY': apiKey,
          'X-Customer': customerId,
          'X-Signature': sig
        }
      }
    );
    if (!res.ok) return null;
    const d = await res.json();
    const list = d.keywordList || [];
    if (!list.length) return null;

    const parseVol = v => { if (typeof v === 'number') return v; if (String(v).startsWith('<')) return 5; return Number(v) || 0; };
    const norm = s => (s || '').replace(/\s+/g, '').toLowerCase();
    const normKw = norm(keyword);

    // 1순위: 정확 일치
    let kw = list.find(k => norm(k.relKeyword) === normKw);
    // 2순위: 입력 키워드가 relKeyword에 포함되거나 반대
    if (!kw) kw = list.find(k => norm(k.relKeyword).includes(normKw) || normKw.includes(norm(k.relKeyword)));
    // 3순위: 검색량 가장 높은 첫 번째
    if (!kw) kw = list.sort((a, b) => (parseVol(b.monthlyPcQcCnt) + parseVol(b.monthlyMobileQcCnt)) - (parseVol(a.monthlyPcQcCnt) + parseVol(a.monthlyMobileQcCnt)))[0];

    if (!kw) return null;
    const pc  = parseVol(kw.monthlyPcQcCnt);
    const mob = parseVol(kw.monthlyMobileQcCnt);
    return { pc, mobile: mob, total: pc + mob, compIdx: kw.compIdx, matchedKeyword: kw.relKeyword };
  } catch { return null; }
}

// 네이버 검색광고 API - 연관 키워드 전체 목록
async function naverRelatedKeywords(hint, apiKey, secretKey, customerId) {
  if (!apiKey || !secretKey || !customerId) return [];
  try {
    const ts  = Date.now().toString();
    const sig = crypto.createHmac('sha256', secretKey)
                      .update(`${ts}_GET_/keywordstool`)
                      .digest('base64');
    const res = await fetch(
      `https://api.naver.com/keywordstool?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`,
      { headers: { 'X-Timestamp': ts, 'X-API-KEY': apiKey, 'X-Customer': customerId, 'X-Signature': sig } }
    );
    if (!res.ok) return [];
    const d = await res.json();
    const parseVol = v => { if (typeof v === 'number') return v; if (String(v).startsWith('<')) return 5; return Number(v) || 0; };
    return (d.keywordList || []).map(kw => {
      const pc  = parseVol(kw.monthlyPcQcCnt);
      const mob = parseVol(kw.monthlyMobileQcCnt);
      return { keyword: kw.relKeyword, pc, mobile: mob, total: pc + mob, compIdx: kw.compIdx };
    });
  } catch { return []; }
}

// 네이버 뉴스 검색 (실시간 뉴스)
async function naverNewsSearch(query, cid, csec) {
  if (!cid || !csec) return null;
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=15&sort=date`,
      { headers: { 'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': csec } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d.items ?? null;
  } catch { return null; }
}

// 네이버 쇼핑 검색 (상품수)
async function naverShoppingSearch(query, cid, csec) {
  if (!cid || !csec) return null;
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=1`,
      { headers: { 'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': csec } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d.total ?? null;
  } catch { return null; }
}

// 수치 → 레벨 변환
function compLevel(total) {
  if (total === null || total === undefined) return null;
  if (total < 5000)  return '낮음';
  if (total < 50000) return '중간';
  return '높음';
}

function volLevel(total) {
  if (total === null || total === undefined) return null;
  if (total < 1000)  return '낮음';
  if (total < 10000) return '중간';
  return '높음';
}

function trendLevel(avg) {
  if (avg === null || avg === undefined) return null;
  if (avg < 20) return '낮음';
  if (avg < 60) return '중간';
  return '높음';
}

// ── Claude API 호출 ──────────────────────────────────────────

async function claude(apiKey, system, user, maxTokens = 2500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'Claude API 오류');
  }
  const d = await res.json();
  const text = d.content?.[0]?.text || '';
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('응답 파싱 오류');
  }
}

// ── 메인 핸들러 ──────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY;
  const NAVER_CID   = process.env.NAVER_CLIENT_ID;
  const NAVER_CSEC  = process.env.NAVER_CLIENT_SECRET;
  const AD_KEY      = process.env.NAVER_AD_API_KEY;
  const AD_SECRET   = process.env.NAVER_AD_SECRET_KEY;
  const AD_CUSTOMER = process.env.NAVER_AD_CUSTOMER_ID;

  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Claude API 키가 없습니다.' });

  const { mode, topic, platform, keyword, blogUrl,
          neighbors, todayVisitors, totalVisitors, avgVisitors, postCount, isInfluencer,
          draft, length, imageData, imageType, message } = req.body;
  const hasNaver = !!(NAVER_CID && NAVER_CSEC);
  const hasAds   = !!(AD_KEY && AD_SECRET && AD_CUSTOMER);

  try {
    let result;

    // ① 키워드 추천
    if (mode === 'keyword-recommend') {
      let naverContext = '';
      if (hasNaver) {
        const [comp, trend] = await Promise.all([
          naverBlogSearch(topic, NAVER_CID, NAVER_CSEC),
          naverDataLab(topic, NAVER_CID, NAVER_CSEC)
        ]);
        const vol = hasAds ? await naverSearchVolume(topic, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;
        if (comp !== null) naverContext += `\n네이버 블로그 검색결과 수: ${comp.toLocaleString()}개 (경쟁도 참고)`;
        if (trend) naverContext += `\n데이터랩 최근 3개월 평균 트렌드 점수: ${trend.avg}`;
        if (vol)   naverContext += `\n월간 검색량: PC ${vol.pc.toLocaleString()} + 모바일 ${vol.mobile.toLocaleString()} = 총 ${vol.total.toLocaleString()}`;
      }

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. ${topic ? topic + ' 분야 특화.' : '전 분야 대응.'} 순수 JSON만 반환.
${naverContext ? '아래 네이버 실데이터를 반영해 분석하세요.' : ''}

{
  "mainKeywords":[{"keyword":"","searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","tip":""}],
  "longtailKeywords":[""],
  "titleSuggestions":["","",""],
  "naverStrategy":{"summary":"","tips":[""]},
  "tistoryStrategy":{"summary":"","tips":[""]},
  "contentStructure":[""],
  "dataSource":"${hasNaver ? '네이버 실데이터 + Claude AI' : 'Claude AI'}"
}
mainKeywords 5개, longtailKeywords 10개. 플랫폼이 "네이버 블로그만"이면 naverStrategy만, "티스토리만"이면 tistoryStrategy만.`,
        `주제: ${topic}\n플랫폼: ${platform}${naverContext}`
      );
    }

    // ② 황금 키워드 추출
    else if (mode === 'golden-keyword') {
      // 1단계: 네이버 Ad API에서 실제 연관 키워드 가져오기 (AI 생성 아님)
      const relKws = hasAds
        ? await naverRelatedKeywords(topic, AD_KEY, AD_SECRET, AD_CUSTOMER)
        : [];

      // 2단계: 검색량 500 이상만 필터링 후 경쟁도(블로그 수) 조회
      const candidates = relKws
        .filter(k => k.total >= 500)
        .sort((a, b) => b.total - a.total)
        .slice(0, 20);

      const withBlogCount = await Promise.all(
        candidates.map(async k => {
          const bc = hasNaver
            ? await naverBlogSearch(k.keyword, NAVER_CID, NAVER_CSEC)
            : null;
          return { ...k, blogCount: bc };
        })
      );

      // 3단계: 황금도 계산 (검색량 / 경쟁 포스트 수 비율)
      const goldenScore = (vol, comp) => {
        const v = vol  || 0;
        const c = comp || 999999;
        const ratio = v / (c + 1);
        if (ratio >= 1   && v >= 5000)  return 'A+';
        if (ratio >= 0.5 && v >= 2000)  return 'A';
        if (ratio >= 0.2 && v >= 1000)  return 'B+';
        if (ratio >= 0.1)               return 'B';
        if (v >= 5000)                  return 'B';
        return 'C';
      };
      const volLabel  = v => v >= 10000 ? '높음' : v >= 2000 ? '중간' : '낮음';
      const compLabel = c => c <= 5000  ? '낮음' : c <= 30000 ? '중간' : '높음';

      const scored = withBlogCount
        .map(k => ({
          keyword:       k.keyword,
          searchVolume:  volLabel(k.total),
          competition:   k.blogCount !== null ? compLabel(k.blogCount) : '조회불가',
          goldenScore:   goldenScore(k.total, k.blogCount),
          monthlyPc:     k.pc,
          monthlyMobile: k.mobile,
          monthlyTotal:  k.total,
          blogCount:     k.blogCount,
          reason: `월검색 ${k.total.toLocaleString()}회 · 블로그 ${(k.blogCount ?? 0).toLocaleString()}개`
        }))
        .sort((a, b) => {
          const order = { 'A+':0, 'A':1, 'B+':2, 'B':3, 'C':4 };
          return (order[a.goldenScore] ?? 5) - (order[b.goldenScore] ?? 5);
        })
        .slice(0, 8);

      result = {
        goldenKeywords: scored,
        tips: [],
        dataSource: hasAds ? '네이버 검색광고 API 실데이터' : 'API 미설정'
      };
    }

    // ③ 키워드 지수 조회
    else if (mode === 'keyword-index') {
      const [blogCount, trend] = await Promise.all([
        hasNaver ? naverBlogSearch(keyword, NAVER_CID, NAVER_CSEC) : Promise.resolve(null),
        hasNaver ? naverDataLab(keyword, NAVER_CID, NAVER_CSEC)    : Promise.resolve(null)
      ]);
      const vol = hasAds ? await naverSearchVolume(keyword, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;

      const naverCtx = [
        blogCount !== null ? `블로그 포스트 수: ${blogCount.toLocaleString()}개` : '',
        trend     ? `데이터랩 트렌드 평균: ${trend.avg}` : '',
        vol       ? `월간 검색량: PC ${vol.pc.toLocaleString()} + 모바일 ${vol.mobile.toLocaleString()} = ${vol.total.toLocaleString()}` : ''
      ].filter(Boolean).join('\n');

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","exposure":"높음|중간|낮음","analysis":"","naverTips":[""],"tistoryTips":[""],"dataSource":""}
플랫폼이 "네이버 블로그만"이면 naverTips만, "티스토리만"이면 tistoryTips만.`,
        `키워드: ${keyword}\n플랫폼: ${platform}\n\n네이버 실데이터:\n${naverCtx || '없음'}`
      );

      // 네이버 실데이터가 있으면 수치로 덮어씌우기
      if (blogCount !== null) result.competition = compLevel(blogCount) || result.competition;
      if (vol)   result.searchVolume = volLevel(vol.total) || result.searchVolume;
      else if (trend) result.searchVolume = trendLevel(trend.avg) || result.searchVolume;

      result.naverRawData = {
        blogCount,
        trendAvg: trend?.avg ?? null,
        monthlySearch: vol?.total ?? null,
        pc: vol?.pc ?? null,
        mobile: vol?.mobile ?? null
      };
    }

    // ④ 블로그 누락 검사
    else if (mode === 'blog-missing') {
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"causes":[""],"solutions":[""]}
누락 원인 5개, 해결방법 5개.`,
        `블로그: ${blogUrl}\n키워드: ${keyword || '없음'}`
      );
    }

    // ⑤ 블로그 지수 조회 (Level 0~10 포함)
    else if (mode === 'blog-index') {
      // 스크린샷이 있으면 Vision으로 실제 수치 추출
      let statsCtx = '수치 미입력(URL 기반 추정)';
      let extractedFromImage = false;

      if (imageData && imageType) {
        const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 400,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: imageType, data: imageData } },
                { type: 'text', text: '이 네이버 블로그 통계 스크린샷에서 숫자만 추출해. 다음 형식으로만 답해:\n총 포스팅 수: N개\n이웃수: N명\n오늘 방문자: N명\n전체 방문자: N명\n일 평균 방문자: N명\n없는 항목은 생략.' }
              ]
            }]
          })
        });
        if (visionRes.ok) {
          const vd = await visionRes.json();
          const extracted = vd.content?.[0]?.text || '';
          if (extracted && extracted.includes('명') || extracted.includes('개')) {
            statsCtx = extracted.trim();
            extractedFromImage = true;
          }
        }
      }

      if (!extractedFromImage) {
        const statsLines = [
          postCount     ? `총 포스팅 수: ${Number(postCount).toLocaleString()}개`    : '',
          neighbors     ? `이웃수: ${Number(neighbors).toLocaleString()}명`           : '',
          todayVisitors ? `오늘 방문자: ${Number(todayVisitors).toLocaleString()}명`  : '',
          avgVisitors   ? `평균 방문자: ${Number(avgVisitors).toLocaleString()}명/일` : '',
          totalVisitors ? `전체 방문자: ${Number(totalVisitors).toLocaleString()}명`  : '',
          isInfluencer === '있음' ? '인플루언서: YES' : ''
        ].filter(Boolean);
        if (statsLines.length) statsCtx = statsLines.join('\n');
      }

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. ${topic ? topic + ' 분야 특화.' : '전 분야 대응.'} 순수 JSON만 반환.

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

입력된 현황 수치가 있으면 그것을 최우선으로 레벨 판단. 없으면 URL로 추정.

[분석 원칙]
- 충분히 클 수 있는데 못 크고 있는 이유를 구체적으로 진단하라.
- "열심히 하세요" 같은 추상적 조언 금지.
- 수치를 인용하며 "이 수치가 이 레벨 평균 대비 낮다/높다"는 식으로 비교 분석.
- growthBlockers는 가장 치명적인 성장 방해 요인 3가지. 각각 원인+구체적 해결책.

순수 JSON만 반환:
{
  "estimatedLevel": 0,
  "levelReason": "레벨 근거 — 수치 직접 인용 (1~2문장)",
  "scores": [
    {"label":"콘텐츠 품질","value":"A~F","sub":"구체적 한줄 평가"},
    {"label":"업로드 주기","value":"A~F","sub":"몇 개월에 몇 개 수준인지"},
    {"label":"이웃/방문자","value":"A~F","sub":"실제 수치 vs 레벨 평균"},
    {"label":"키워드 최적화","value":"A~F","sub":"구체적 개선 포인트"},
    {"label":"SEO 구조","value":"A~F","sub":"구체적 개선 포인트"}
  ],
  "growthBlockers": [
    {"rank":1,"title":"성장을 막는 가장 큰 원인 제목","diagnosis":"왜 문제인지 수치 근거 포함 2문장","action":"당장 이번 주 할 수 있는 구체적 행동 1가지"},
    {"rank":2,"title":"두 번째 원인","diagnosis":"","action":""},
    {"rank":3,"title":"세 번째 원인","diagnosis":"","action":""}
  ],
  "nextLevelTips": ["다음 레벨 달성 조건 3가지 (구체적 수치 포함)"],
  "summary": "종합 브리핑 — 이 블로그가 충분히 클 수 있는 이유와 현재 못 크는 핵심 이유 (3~4문장)",
  "tips": ["지수 향상 전략 5가지 (각각 구체적 행동 포함)"]
}`,
        `블로그 주소: ${blogUrl}\n주제 분야: ${topic || '미입력'}\n\n[현황 수치]\n${statsCtx}`
      );

      // 링크는 Claude가 지어내지 않도록 백엔드에서 직접 고정 삽입
      const topicEncoded = encodeURIComponent((topic || '블로그') + ' 블로그');
      result.references = [
        { title: '네이버 서치어드바이저', desc: '내 블로그 검색 유입·색인 현황 공식 확인', url: 'https://searchadvisor.naver.com' },
        { title: '네이버 데이터랩', desc: '내 주제 키워드 트렌드 실시간 확인', url: 'https://datalab.naver.com' },
        { title: '네이버 인플루언서 센터', desc: '파워블로거 다음 단계 인플루언서 기준 확인', url: 'https://in.naver.com' },
        { title: '내 분야 상위 블로그 벤치마킹', desc: `${topic || '내 분야'} 상위 노출 블로그 직접 분석`, url: `https://search.naver.com/search.naver?where=blog&query=${topicEncoded}&st=rel` },
        { title: '네이버 블로그 공식 운영 가이드', desc: '네이버가 권장하는 블로그 운영 방법', url: 'https://blog.naver.com/naverblog/221186401631' }
      ];
      result._fromImage = extractedFromImage;
    }

    // ⑥ 블로그 지수 심플 (Level 포함)
    else if (mode === 'blog-index-simple') {
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"estimatedLevel":0,"levelReason":"","summary":"","points":[""]}
estimatedLevel은 0~10 정수, levelReason은 1문장, points는 4가지 핵심 체크포인트.`,
        `블로그: ${blogUrl}`
      );
    }

    // ⑦ 키워드마스터 - 검색량 조회
    else if (mode === 'km-search') {
      const [blogCount, trend] = await Promise.all([
        hasNaver ? naverBlogSearch(keyword, NAVER_CID, NAVER_CSEC) : Promise.resolve(null),
        hasNaver ? naverDataLab(keyword, NAVER_CID, NAVER_CSEC)    : Promise.resolve(null)
      ]);
      const vol = hasAds ? await naverSearchVolume(keyword, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","relatedKeywords":[""],"analysis":"","tips":[""]}
relatedKeywords 10개, tips 4개.`,
        `키워드: ${keyword}\n블로그수: ${blogCount ?? '없음'}\n트렌드: ${trend?.avg ?? '없음'}\n월검색량: ${vol?.total ?? '없음'} (PC ${vol?.pc ?? '-'}, 모바일 ${vol?.mobile ?? '-'})`
      );
      result.rawData = {
        blogCount,
        trendAvg: trend?.avg ?? null,
        monthlySearch: vol?.total ?? null,
        pc: vol?.pc ?? null,
        mobile: vol?.mobile ?? null
      };
    }

    // ⑧ 키워드마스터 - 형태소 분석
    else if (mode === 'km-morpheme') {
      result = await claude(CLAUDE_KEY,
        `한국어 형태소 분석 전문가. 순수 JSON만 반환.
{"morphemes":[{"word":"","pos":"명사|동사|형용사|부사","count":0}],"topKeywords":[""],"sentiment":"긍정|부정|중립","sentimentScore":0.0,"sentimentDetail":"","summary":""}
morphemes는 의미있는 단어 위주 최대 30개 빈도순. topKeywords 10개.`,
        `분석할 텍스트:\n${keyword}`,
        3000
      );
    }

    // ⑨ 키워드마스터 - 셀러마스터
    else if (mode === 'km-seller') {
      const productCount = hasNaver ? await naverShoppingSearch(keyword, NAVER_CID, NAVER_CSEC) : null;
      result = await claude(CLAUDE_KEY,
        `한국 온라인 쇼핑 셀러 전문가. 순수 JSON만 반환.
{"competition":"높음|중간|낮음","priceRange":{"min":0,"max":0,"avg":0},"sellerTips":[""],"relatedProducts":[""],"analysis":""}
sellerTips 5개, relatedProducts 5개.`,
        `상품 키워드: ${keyword}\n네이버 쇼핑 상품수: ${productCount !== null ? productCount.toLocaleString() + '개' : '알 수 없음'}`
      );
      result.productCount = productCount;
    }

    // ⑩ 키워드마스터 - 실시간 검색어
    else if (mode === 'km-realtime') {
      const today = new Date().toISOString().slice(0, 10);
      const categoryQuery = {
        '부동산':    '부동산 아파트 전세',
        '금융/경제': '경제 금융 주식',
        '재테크/투자': '재테크 투자 ETF',
        '뉴스/이슈': '이슈 사건 사고',
        '전체':      '주요뉴스 이슈'
      }[topic] || '주요뉴스';

      const newsItems = hasNaver
        ? await naverNewsSearch(categoryQuery, NAVER_CID, NAVER_CSEC)
        : null;

      if (newsItems && newsItems.length > 0) {
        const strip = s => (s || '').replace(/<[^>]*>/g, '').trim();
        const newsTitles = newsItems.slice(0, 12).map((item, i) =>
          `${i+1}. 제목: ${strip(item.title)} / 요약: ${strip(item.description).slice(0, 60)}`
        ).join('\n');

        result = await claude(CLAUDE_KEY,
          `한국 뉴스 트렌드 분석가. 순수 JSON만 반환.
{"keywords":[{"rank":1,"keyword":"핵심검색어(5글자이내)","category":"분야","trend":"상승|신규|유지","desc":"뉴스한줄요약(25자이내)","headline":"원본뉴스제목그대로"}],"summary":"오늘트렌드한줄요약"}
각 뉴스에서 핵심 검색 키워드 추출 + 한줄 요약. keywords 10개.`,
          `분야: ${topic}\n날짜: ${today}\n\n최신 뉴스:\n${newsTitles}`
        );
        result._hasRealNews = true;
      } else {
        result = await claude(CLAUDE_KEY,
          `한국 트렌드 분석 전문가. 순수 JSON만 반환.
{"keywords":[{"rank":1,"keyword":"","category":"","trend":"상승|신규|유지","desc":""}],"summary":""}
keywords 10개. 오늘 날짜 기준 해당 분야 이슈 키워드.`,
          `분야: ${topic || '전체'}\n날짜: ${today}`
        );
        result._hasRealNews = false;
      }
      result.updatedAt = new Date().toLocaleString('ko-KR', { hour12: false });
    }

    // ⑪ 유튜브 분석기
    else if (mode === 'youtube-analyze') {
      result = await claude(CLAUDE_KEY,
        `한국 유튜브 SEO 전문가. ${topic ? topic + ' 분야 특화.' : '전 분야 대응.'} 순수 JSON만 반환.
{
  "channelAnalysis": {"level":"신규|성장|중급|전문가|파워채널","reason":"채널 수준 분석 1~2문장"},
  "keywordAnalysis": {"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","trending":"상승|유지|하락"},
  "titleSuggestions": ["제목1","제목2","제목3"],
  "recommendedTags": ["태그1","태그2","태그3","태그4","태그5","태그6","태그7","태그8","태그9","태그10"],
  "thumbnailTips": ["썸네일팁1","썸네일팁2","썸네일팁3"],
  "growthStrategy": ["전략1","전략2","전략3","전략4","전략5"],
  "summary": "종합 분석 2~3문장"
}
titleSuggestions는 유튜브 알고리즘 최적화 제목. recommendedTags 10개.`,
        `분석 대상: ${keyword}\n채널 분야: ${topic || '부동산/금융/경제'}`
      );
    }

    // ⑫ 블로그 매트릭스
    else if (mode === 'blog-matrix') {
      const [blogCount, trend] = await Promise.all([
        hasNaver ? naverBlogSearch(keyword, NAVER_CID, NAVER_CSEC) : Promise.resolve(null),
        hasNaver ? naverDataLab(keyword, NAVER_CID, NAVER_CSEC)    : Promise.resolve(null)
      ]);
      const vol = hasAds ? await naverSearchVolume(keyword, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 종합 매트릭스 분석. 순수 JSON만 반환.
{
  "blogLevel": {"level":0,"reason":"레벨 근거 1문장"},
  "keywordStatus": {"searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음","opportunity":"높음|중간|낮음"},
  "goldenKeywords": [{"keyword":"","score":"★~★★★★★","reason":""}],
  "competitionMatrix": [{"competitor":"경쟁유형","strength":"강점","weakness":"약점"}],
  "contentPlan": ["콘텐츠계획1","콘텐츠계획2","콘텐츠계획3"],
  "quickWins": ["빠른성과전략1","빠른성과전략2","빠른성과전략3"],
  "summary": "종합 분석 2~3문장"
}
goldenKeywords 3개, competitionMatrix 3개, contentPlan 4개, quickWins 4개.`,
        `블로그: ${blogUrl}\n키워드: ${keyword}\n플랫폼: ${platform||'둘 다'}\n블로그수: ${blogCount ?? '없음'}\n트렌드: ${trend?.avg ?? '없음'}\n월검색량: ${vol?.total ?? '없음'}`
      );
      result.rawData = {
        blogCount,
        trendAvg: trend?.avg ?? null,
        monthlySearch: vol?.total ?? null
      };
    }

    // ⑬ 무한 키워드
    else if (mode === 'infinite-keyword') {
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. ${topic ? topic + ' 분야 특화.' : '전 분야 대응.'} 순수 JSON만 반환.
{"keywords":[{"keyword":"","type":"메인|세부|롱테일","searchVolume":"높음|중간|낮음","competition":"높음|중간|낮음"}],"totalCount":0,"summary":""}
주어진 주제에서 메인 키워드 10개 + 세부 키워드 20개 + 롱테일 키워드 20개 = 총 50개 추출.
keywords 배열에 50개 모두 포함. totalCount는 50.`,
        `주제: ${topic}\n플랫폼: ${platform || '둘 다'}`
      );
    }

    // ⑭ 세부키워드 조합기 (Claude로 최적화 태그 생성)
    else if (mode === 'keyword-combiner') {
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{
  "comma": "키워드1, 키워드2, 키워드3 ...",
  "space": "키워드1 키워드2 키워드3 ...",
  "hashtag": "#키워드1 #키워드2 #키워드3 ...",
  "naverTag": "키워드1,키워드2,키워드3",
  "recommended": ["추천조합1(3단어)","추천조합2","추천조합3","추천조합4","추천조합5"],
  "totalCount": 0
}
입력된 키워드들을 4가지 형식으로 변환하고, 검색 노출에 유리한 조합 5개 추천.`,
        `키워드 목록:\n${keyword}`
      );
    }

    // ⑮-a 스마트 채팅 (Tool Use — 네이버 API 실시간 조회)
    else if (mode === 'smart-chat') {
      const { messages } = req.body;
      if (!messages?.length) return res.status(400).json({ error: '메시지가 없습니다.' });

      const tools = [
        {
          name: 'naver_keyword_data',
          description: '네이버 API로 키워드의 실제 월간 검색량(PC+모바일)과 블로그 경쟁 포스트 수를 조회합니다. 키워드 데이터가 필요할 때 반드시 이 도구를 사용하세요.',
          input_schema: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: '조회할 키워드' }
            },
            required: ['keyword']
          }
        },
        {
          name: 'naver_related_keywords',
          description: '네이버 API로 주제 관련 실제 연관 검색어 목록과 각각의 검색량을 가져옵니다. 황금 키워드를 찾을 때 사용하세요.',
          input_schema: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: '연관 키워드를 찾을 주제' }
            },
            required: ['topic']
          }
        }
      ];

      const systemPrompt = `당신은 한국 블로그 SEO 전문 코치입니다. ${topic ? topic + ' 분야 특화.' : '모든 분야 대응.'}

[핵심 원칙]
- 키워드 검색량, 경쟁도, 황금 키워드에 관한 질문은 반드시 도구를 먼저 호출해 실데이터를 확인하세요.
- 절대 추측하거나 어림잡은 수치를 말하지 마세요.
- 도구 결과를 받은 뒤 실제 숫자를 명시하며 답하세요.
- 데이터 없이 답할 수 없는 질문에는 "도구로 조회해볼게요"라고 말하고 즉시 호출하세요.
- 자연스러운 한국어 대화체로 답하세요.`;

      let msgs = messages.map(m => ({ role: m.role, content: m.content }));
      let finalReply = '';

      for (let i = 0; i < 5; i++) {
        const res2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1024, system: systemPrompt, tools, messages: msgs })
        });
        if (!res2.ok) { const e = await res2.json(); return res.status(res2.status).json({ error: e.error?.message || 'API 오류' }); }
        const d = await res2.json();

        if (d.stop_reason === 'end_turn') {
          finalReply = d.content?.find(c => c.type === 'text')?.text || '';
          break;
        }

        if (d.stop_reason === 'tool_use') {
          const toolUseBlocks = d.content.filter(c => c.type === 'tool_use');
          msgs.push({ role: 'assistant', content: d.content });

          const toolResults = await Promise.all(toolUseBlocks.map(async block => {
            let output = '';
            if (block.name === 'naver_keyword_data') {
              const kw = block.input.keyword;
              const [vol, bc] = await Promise.all([
                hasAds   ? naverSearchVolume(kw, AD_KEY, AD_SECRET, AD_CUSTOMER) : Promise.resolve(null),
                hasNaver ? naverBlogSearch(kw, NAVER_CID, NAVER_CSEC)            : Promise.resolve(null)
              ]);
              const score = (() => {
                const v = vol?.total||0, c = bc||999999, r = v/(c+1);
                if(r>=1&&v>=5000)return'A+'; if(r>=0.5&&v>=2000)return'A';
                if(r>=0.2&&v>=1000)return'B+'; if(r>=0.1)return'B'; if(v>=5000)return'B'; return'C';
              })();
              output = vol
                ? `키워드: ${kw}\n월간검색량(합): ${vol.total.toLocaleString()}회\nPC: ${vol.pc.toLocaleString()}회\n모바일: ${vol.mobile.toLocaleString()}회\n블로그경쟁포스트수: ${bc?.toLocaleString() ?? '조회불가'}개\n황금도: ${score}`
                : `키워드: ${kw}\n데이터 없음 (검색량 매우 낮음 또는 API 오류)`;
            } else if (block.name === 'naver_related_keywords') {
              const list = await naverRelatedKeywords(block.input.topic, AD_KEY, AD_SECRET, AD_CUSTOMER);
              const top = list.filter(k => k.total >= 300).sort((a,b) => b.total - a.total).slice(0, 15);
              output = top.length
                ? `주제 "${block.input.topic}" 연관 키워드:\n` + top.map(k => `- ${k.keyword}: 월 ${k.total.toLocaleString()}회`).join('\n')
                : '연관 키워드 데이터 없음';
            }
            return { type: 'tool_result', tool_use_id: block.id, content: output };
          }));

          msgs.push({ role: 'user', content: toolResults });
        } else {
          finalReply = d.content?.find(c => c.type === 'text')?.text || '';
          break;
        }
      }

      return res.status(200).json({ reply: finalReply });
    }

    // ⑮ 대화형 블로그 코칭 챗
    else if (mode === 'chat') {
      const { messages, blogContext } = req.body;
      if (!messages?.length) return res.status(400).json({ error: '메시지가 없습니다.' });

      const ctx = blogContext || {};
      const statsLines = [
        ctx.postCount      ? `포스팅 수: ${ctx.postCount}개`          : '',
        ctx.neighbors      ? `이웃수: ${ctx.neighbors}명`              : '',
        ctx.todayVisitors  ? `오늘 방문자: ${ctx.todayVisitors}명`     : '',
        ctx.avgVisitors    ? `평균 방문자: ${ctx.avgVisitors}명/일`    : '',
        ctx.totalVisitors  ? `전체 방문자: ${ctx.totalVisitors}명`     : '',
        ctx.isInfluencer === '있음' ? '인플루언서: YES'               : ''
      ].filter(Boolean).join(' / ');

      const systemPrompt = `당신은 한국 블로그 SEO 전문 코치입니다. 부동산·금융·경제 분야 블로그 특화.

[분석된 블로그 정보]
- 주소: ${ctx.blogUrl || '미입력'}
- 분야: ${ctx.topic || '부동산/금융/경제'}
- 현재 레벨: Level ${ctx.estimatedLevel ?? '?'} / 10
- 레벨 근거: ${ctx.levelReason || ''}
- 현황 수치: ${statsLines || '미입력'}
- 분석 요약: ${ctx.summary || ''}
- 다음 레벨 조건: ${(ctx.nextLevelTips || []).join(' / ')}

[대화 원칙]
1. 짧고 명확하게. 3~5문장 이내.
2. 구체적 숫자·행동 지침 제시 (예: "이웃수 307명이면 Level 1 정상, 500명 넘기면 Level 2 가능").
3. 부동산·금융·경제 블로그 특성 반영.
4. 네이버·티스토리 차이 구분 설명.
5. 정직한 선배처럼 솔직하게.
6. 블로그 분석을 안 했어도 일반 SEO 질문에 답변 가능.
7. 마지막에 다음 질문 유도 한마디.

JSON 없이 자연스러운 한국어 대화체로 답하세요.`;

      const chatRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 600,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });
      if (!chatRes.ok) {
        const e = await chatRes.json();
        return res.status(chatRes.status).json({ error: e.error?.message || 'Claude API 오류' });
      }
      const chatData = await chatRes.json();
      return res.status(200).json({ reply: chatData.content?.[0]?.text || '' });
    }

    // 대본 → 키워드 추출
    else if (mode === 'draft-to-keyword') {
      // 1단계: Claude는 키워드 후보만 추출 (점수/수치 추측 없이)
      const extracted = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"keywords":["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8"],"missingKeywords":["추가하면좋을키워드1","추가하면좋을키워드2","추가하면좋을키워드3"],"seoTips":["팁1","팁2","팁3","팁4"]}
글에서 SEO에 쓸 만한 검색 키워드 8개 추출. missingKeywords는 글에 없지만 추가하면 좋을 키워드 3개. 키워드만 반환, 점수/평가 없이.`,
        `플랫폼: ${platform||'둘 다'}\n\n[블로그 대본]\n${draft.slice(0,3000)}`
      );

      const kwList = extracted.keywords || [];

      // 2단계: 각 키워드 실제 네이버 데이터 조회
      const kwData = await Promise.all(
        kwList.map(async kw => {
          const [vol, bc] = await Promise.all([
            hasAds   ? naverSearchVolume(kw, AD_KEY, AD_SECRET, AD_CUSTOMER) : Promise.resolve(null),
            hasNaver ? naverBlogSearch(kw, NAVER_CID, NAVER_CSEC)            : Promise.resolve(null)
          ]);
          return { keyword: kw, vol, blogCount: bc };
        })
      );

      // 3단계: 실수치로 황금도 계산
      const goldenScore = (vol, comp) => {
        const v = vol  || 0;
        const c = comp || 999999;
        const ratio = v / (c + 1);
        if (ratio >= 1   && v >= 5000) return 'A+';
        if (ratio >= 0.5 && v >= 2000) return 'A';
        if (ratio >= 0.2 && v >= 1000) return 'B+';
        if (ratio >= 0.1)              return 'B';
        if (v >= 5000)                 return 'B';
        return 'C';
      };
      const volLabel  = v => v >= 10000 ? '높음' : v >= 2000 ? '중간' : '낮음';
      const compLabel = c => c <= 5000  ? '낮음' : c <= 30000 ? '중간' : '높음';

      result = {
        keywords: kwData.map(k => ({
          keyword:       k.keyword,
          searchVolume:  k.vol ? volLabel(k.vol.total) : '조회불가',
          competition:   k.blogCount !== null ? compLabel(k.blogCount) : '조회불가',
          goldenScore:   goldenScore(k.vol?.total, k.blogCount),
          monthlyPc:     k.vol?.pc     ?? null,
          monthlyMobile: k.vol?.mobile ?? null,
          monthlyTotal:  k.vol?.total  ?? null,
          blogCount:     k.blogCount   ?? null,
          why: `월검색 ${(k.vol?.total ?? 0).toLocaleString()}회 · 블로그 ${(k.blogCount ?? 0).toLocaleString()}개`
        })).sort((a,b) => {
          const o = {'A+':0,'A':1,'B+':2,'B':3,'C':4};
          return (o[a.goldenScore]??5) - (o[b.goldenScore]??5);
        }),
        missingKeywords: extracted.missingKeywords || [],
        seoTips: extracted.seoTips || []
      };
    }

    // 키워드 → 대본 생성
    else if (mode === 'keyword-to-draft') {
      const currentYear = new Date().getFullYear();
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문 작가. ${topic ? topic + ' 분야 특화.' : '전 분야 대응.'} 순수 JSON만 반환.
{"draft":"완성된 블로그 대본(제목 포함, 단락 구분은 \\n\\n 사용)","usedKeywords":["SEO 키워드 5개"],"seoTips":["체크리스트 4가지"]}
대본 원칙: 첫 문장에 핵심 키워드, 소제목으로 구조화, 검색 표현 자연스럽게 삽입, 글 길이: ${length||'중간 (800~1200자)'}, 친근하고 전문적인 한국어.
⚠️ 연도 규칙: 글에서 연도를 언급할 때 반드시 ${currentYear}년 기준으로 작성. "${currentYear-1}년" 또는 이전 연도는 과거 사례로만 사용.`,
        `키워드: ${keyword}\n분야: ${topic||'미입력'}\n현재연도: ${currentYear}년`
      );
    }

    // ⑰ 포스트 추적기 (내 블로그 포스트 키워드 분석)
    else if (mode === 'post-tracker') {
      const blogId = (blogUrl || '').replace(/^https?:\/\/blog\.naver\.com\//i, '').replace(/\/$/, '').trim();
      if (!blogId) return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });

      // RSS 가져오기
      const rssRes = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' }
      });
      if (!rssRes.ok) return res.status(400).json({ error: `RSS 불러오기 실패 (${rssRes.status}). 블로그 ID를 확인하세요.` });
      const rssText = await rssRes.text();

      // XML 파싱 (간단한 regex 파서)
      const extractTag = (xml, tag) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        return (m ? (m[1] || m[2]) : '').trim();
      };
      const extractAllTags = (xml, tag) => {
        const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
        const matches = [];
        let m;
        while ((m = re.exec(xml)) !== null) matches.push((m[1] || m[2]).trim());
        return matches;
      };

      // <item> 블록들 추출
      const itemBlocks = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/gi;
      let im;
      while ((im = itemRe.exec(rssText)) !== null) itemBlocks.push(im[1]);

      const posts = itemBlocks.slice(0, 15).map(block => {
        const title = extractTag(block, 'title').replace(/<[^>]*>/g, '');
        const link = extractTag(block, 'link') || extractAllTags(block, 'link')[0] || '';
        const pubDate = extractTag(block, 'pubDate');
        const desc = extractTag(block, 'description').replace(/<[^>]*>/g, '').slice(0, 200);
        // 해시태그 추출 (#태그 형식)
        const fullDesc = extractTag(block, 'description');
        const hashtags = [...new Set([
          ...(fullDesc.match(/#([가-힣a-zA-Z0-9_]+)/g) || []).map(h => h.slice(1)),
          ...(desc.match(/#([가-힣a-zA-Z0-9_]+)/g) || []).map(h => h.slice(1))
        ])].slice(0, 8);
        // 제목에서 의미있는 2~3단어 복합 키워드 추출
        const stopWords = new Set(['이다','있다','없다','하다','되다','오늘','내일','이번','다음','그냥','아직','정말','매우','너무','가장','많이','그리고','하지만','그래서','위해','통해','대해','함께','이후','이전','분석','정리','총정리','완벽','최신','심층','방문','감사','공유','내용','발표','보완','대책','오를까','오르나','왜','꼭','알아야','들의','잃은','넘을까','바로','모든','중']);
        // 공백/특수문자로 분리 후 토씨 제거
        const rawWords = title.split(/[\s,·[\]「」『』【】《》<>()（）""''!?!?…·•\/\\|@#$%^&*+=~`—\-]+/).filter(Boolean);
        const cleanWords = rawWords
          .map(w => w
            .replace(/^[^가-힣a-zA-Z0-9]+|[^가-힣a-zA-Z0-9]+$/g, '')
            .replace(/(은|는|이|가|을|를|의|에|로|도|만|와|과|서|며|나|랑|인데|이고|하고|한데|으로|에서|부터|까지|에게|한테|이란|이면|이든|이나|거나|지만|라도|라서|라고|이라|다면|다고|다는|이는|한다|된다|된|한|들의|들도|들은|들이|들을)$/, ''))
          .filter(w => w.length >= 2 && /[가-힣]/.test(w) && !stopWords.has(w));
        // 2단어 조합 키워드 생성 (인접한 두 단어)
        const titleKeywords = [];
        for (let i = 0; i < cleanWords.length && titleKeywords.length < 4; i++) {
          if (cleanWords[i].length >= 2) {
            if (i + 1 < cleanWords.length && cleanWords[i+1]?.length >= 2) {
              titleKeywords.push(`${cleanWords[i]} ${cleanWords[i+1]}`); // 2단어 조합
            } else {
              titleKeywords.push(cleanWords[i]);
            }
          }
        }
        return { title, link, pubDate, desc, hashtags, titleKeywords };
      });

      if (!posts.length) return res.status(400).json({ error: 'RSS에서 포스트를 찾을 수 없습니다.' });

      // 전체 고유 키워드 수집 (해시태그 우선)
      const allKeywords = [...new Set(
        posts.flatMap(p => [...p.hashtags, ...p.titleKeywords]).filter(k => k.length >= 2)
      )].slice(0, 30);

      // 검색량 조회 (최대 12개, 순차 처리로 Rate Limit 방지)
      let volumeMap = {};
      if (hasAds && allKeywords.length > 0) {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const kwsToCheck = allKeywords.slice(0, 12);
        for (const kw of kwsToCheck) {
          const vol = await naverSearchVolume(kw, AD_KEY, AD_SECRET, AD_CUSTOMER);
          if (vol) volumeMap[kw] = vol;
          await sleep(250);
        }
      }

      // 각 포스트에 검색량 붙이기
      const enrichedPosts = posts.map(p => ({
        title: p.title,
        link: p.link,
        pubDate: p.pubDate ? new Date(p.pubDate).toLocaleDateString('ko-KR') : '',
        desc: p.desc,
        keywords: [...p.hashtags, ...p.titleKeywords.filter(k => !p.hashtags.includes(k))].slice(0, 6).map(k => ({
          keyword: k,
          vol: volumeMap[k] || null
        }))
      }));

      // 베스트 키워드 (검색량 상위)
      const bestKeywords = Object.entries(volumeMap)
        .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
        .slice(0, 10)
        .map(([kw, v]) => ({ keyword: kw, total: v.total, pc: v.pc, mobile: v.mobile, compIdx: v.compIdx }));

      result = { posts: enrichedPosts, bestKeywords, blogId, totalPosts: posts.length };
    }

    // 키워드 실데이터 조회 (AI 없음 — 네이버 API 직접)
    else if (mode === 'kw-checker') {
      const keywords = (req.body.keywords || []).slice(0, 10);
      if (!keywords.length) return res.status(400).json({ error: '키워드를 입력해주세요.' });

      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const rows = [];
      for (const kw of keywords) {
        // 블로그 경쟁 수는 병렬, Ad API는 순차 (Rate Limit 방지)
        const [vol, bc] = await Promise.all([
          hasAds   ? naverSearchVolume(kw, AD_KEY, AD_SECRET, AD_CUSTOMER) : Promise.resolve(null),
          hasNaver ? naverBlogSearch(kw, NAVER_CID, NAVER_CSEC)            : Promise.resolve(null)
        ]);
        const total = vol?.total ?? null;
        const comp  = bc ?? null;
        const score = (() => {
          const v = total || 0, c = comp || 999999, r = v / (c + 1);
          if (r >= 1   && v >= 5000) return 'A+';
          if (r >= 0.5 && v >= 2000) return 'A';
          if (r >= 0.2 && v >= 1000) return 'B+';
          if (r >= 0.1)              return 'B';
          if (v >= 5000)             return 'B';
          return 'C';
        })();
        rows.push({ keyword: kw, pc: vol?.pc ?? null, mobile: vol?.mobile ?? null, total, blogCount: comp, score });
        await sleep(300); // 네이버 API Rate Limit 방지
      }

      result = { rows };
    }

    // ⑱ 순위 체커 — 키워드 검색 시 내 블로그 몇 위?
    else if (mode === 'rank-checker') {
      if (!hasNaver) return res.status(400).json({ error: '네이버 API가 설정되지 않았습니다.' });
      if (!keyword || !blogUrl) return res.status(400).json({ error: '키워드와 블로그 URL을 입력해주세요.' });

      // 블로그 ID 추출 (blog.naver.com/ID 또는 ID만)
      const blogId = blogUrl
        .replace(/^https?:\/\//i, '')
        .replace(/^blog\.naver\.com\//i, '')
        .replace(/\/$/, '')
        .split('/')[0]
        .toLowerCase();

      const searchResult = await naverBlogSearchItems(keyword, NAVER_CID, NAVER_CSEC, 30);
      if (!searchResult) return res.status(500).json({ error: '네이버 검색 API 오류' });

      const strip = s => (s || '').replace(/<[^>]*>/g, '').trim();
      const items = searchResult.items.map((item, idx) => {
        const link = item.link || item.bloggerlink || '';
        const bloggerlink = item.bloggerlink || '';
        const isMe = bloggerlink.toLowerCase().includes(blogId) || link.toLowerCase().includes(blogId);
        return {
          rank: idx + 1,
          title: strip(item.title),
          bloggerName: item.bloggername || '',
          bloggerLink: bloggerlink,
          link,
          postDate: item.postdate || '',
          isMe
        };
      });

      const myRank = items.find(i => i.isMe);
      result = {
        keyword,
        blogId,
        myRank: myRank ? myRank.rank : null,
        totalResults: searchResult.total,
        checkedCount: items.length,
        items: items.slice(0, 10), // 상위 10개만 프론트에 전달
        message: myRank
          ? `"${keyword}" 검색 시 상위 ${items.length}개 중 ${myRank.rank}위 노출`
          : `"${keyword}" 검색 상위 ${items.length}개 안에 미노출`
      };
    }

    else {
      return res.status(400).json({ error: '지원하지 않는 모드입니다.' });
    }

    return res.status(200).json({ ...result, _hasNaver: hasNaver, _hasAds: hasAds });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
