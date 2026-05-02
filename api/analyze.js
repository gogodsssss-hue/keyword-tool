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
    const kw = d.keywordList?.find(k => k.relKeyword === keyword) || d.keywordList?.[0];
    if (!kw) return null;
    const pc  = Number(kw.monthlyPcQcCnt)     || 0;
    const mob = Number(kw.monthlyMobileQcCnt) || 0;
    return { pc, mobile: mob, total: pc + mob, compIdx: kw.compIdx };
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
      model: 'claude-haiku-4-5-20251001',
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

  const { mode, topic, platform, keyword, blogUrl } = req.body;
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
        `한국 블로그 SEO 전문가. 부동산·금융·경제 특화. 순수 JSON만 반환.
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
      const candidates = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"candidates":["키워드1","키워드2","키워드3","키워드4","키워드5","키워드6","키워드7","키워드8","키워드9","키워드10"]}
부동산·금융·경제 분야에서 검색량 높고 경쟁 낮을 것 같은 후보 키워드 10개만 반환.`,
        `주제: ${topic}`
      );

      let enriched = (candidates.candidates || []).map(k => ({ keyword: k, blogCount: null, trend: null, vol: null }));

      if (hasNaver) {
        const results = await Promise.all(
          enriched.map(async item => {
            const [bc, tr] = await Promise.all([
              naverBlogSearch(item.keyword, NAVER_CID, NAVER_CSEC),
              naverDataLab(item.keyword, NAVER_CID, NAVER_CSEC)
            ]);
            const vol = hasAds ? await naverSearchVolume(item.keyword, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;
            return { ...item, blogCount: bc, trend: tr, vol };
          })
        );
        enriched = results;
        // 경쟁도 낮은 순 정렬
        enriched.sort((a, b) => (a.blogCount || 999999) - (b.blogCount || 999999));
      }

      const dataCtx = enriched.map(k =>
        `- ${k.keyword}: 블로그수 ${k.blogCount ?? '?'}개, 트렌드점수 ${k.trend?.avg ?? '?'}, 월검색량 ${k.vol?.total ?? '?'}`
      ).join('\n');

      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 순수 JSON만 반환.
{"goldenKeywords":[{"keyword":"","searchVolume":"높음|중간|낮음","competition":"낮음|중간","goldenScore":"★~★★★★★","reason":""}],"tips":[""],"dataSource":""}
goldenKeywords 8개, 황금도는 ★1~5개. dataSource는 실데이터 사용 여부 표기.`,
        `주제: ${topic}\n플랫폼: ${platform}\n\n네이버 실데이터:\n${dataCtx}`
      );
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
      result = await claude(CLAUDE_KEY,
        `한국 블로그 SEO 전문가. 부동산·금융·경제 특화. 순수 JSON만 반환.

키워드마스터 기준 블로그 레벨 0~10 시스템:
Level 0: 신생 블로그 (포스팅 0~5개)
Level 1: 입문 (5~20개)
Level 2: 초보 (20~50개, 소폭 유입)
Level 3: 성장 (50~100개, 키워드 유입 시작)
Level 4: 활성 (100~200개, 일정 트래픽)
Level 5: 중급 (200~400개, 네이버 노출 안정)
Level 6: 숙련 (400~700개, C-Rank 인정)
Level 7: 고급 (700~1000개, 경쟁 키워드 노출)
Level 8: 전문가 (1000~1500개, 상위 노출 빈번)
Level 9: 파워블로거 (1500~2000개, 강력한 권위)
Level 10: 최고 권위 (2000개+, 어떤 키워드도 노출)

순수 JSON만 반환:
{
  "estimatedLevel": 0~10,
  "levelReason": "레벨 추정 근거 (1~2문장)",
  "scores": [
    {"label":"콘텐츠 품질","value":"A~F","sub":"한줄평가"},
    {"label":"업로드 주기","value":"A~F","sub":"한줄평가"},
    {"label":"키워드 최적화","value":"A~F","sub":"한줄평가"},
    {"label":"이웃/독자 반응","value":"A~F","sub":"한줄평가"},
    {"label":"SEO 구조","value":"A~F","sub":"한줄평가"}
  ],
  "nextLevelTips": ["다음 레벨까지 필요한 것 3가지"],
  "summary": "종합 분석 (2~3문장)",
  "tips": ["지수 향상 전략 6가지"]
}`,
        `블로그 주소: ${blogUrl}\n주제 분야: ${topic || '부동산/금융/경제'}`
      );
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

    // ⑦ 대화형 블로그 코칭
    else if (mode === 'chat') {
      const { messages, blogContext } = req.body;
      if (!messages?.length) return res.status(400).json({ error: '메시지가 없습니다.' });

      const ctx = blogContext || {};
      const systemPrompt = `당신은 한국 블로그 SEO 전문 코치입니다. 부동산·금융·경제 분야 블로그에 특화되어 있습니다.

분석된 블로그 정보:
- 블로그 주소: ${ctx.blogUrl || '미입력'}
- 주제 분야: ${ctx.topic || '부동산/금융/경제'}
- 현재 추정 레벨: Level ${ctx.estimatedLevel ?? '?'} (0~10)
- 레벨 추정 근거: ${ctx.levelReason || ''}
- 종합 분석: ${ctx.summary || ''}
- 다음 레벨 조건: ${(ctx.nextLevelTips || []).join(' / ')}

대화 원칙:
1. 짧고 명확하게 말하세요. 한 답변은 3~5문장 이내.
2. 구체적인 숫자와 행동 지침을 제시하세요.
3. 부동산·금융·경제 블로그 특성을 반영하세요.
4. 네이버 블로그와 티스토리 차이를 구분해서 설명하세요.
5. "정직한 선배"처럼 솔직하고 실용적으로 안내하세요.
6. 마지막에 다음 질문을 유도하는 짧은 한 마디를 추가하세요.

JSON 없이 자연스러운 한국어 대화체로 답하세요.`;

      const res2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });
      if (!res2.ok) {
        const e = await res2.json();
        return res.status(res2.status).json({ error: e.error?.message || 'Claude API 오류' });
      }
      const d2 = await res2.json();
      return res.status(200).json({ reply: d2.content?.[0]?.text || '' });
    }

    else {
      return res.status(400).json({ error: '지원하지 않는 모드입니다.' });
    }

    return res.status(200).json({ ...result, _hasNaver: hasNaver, _hasAds: hasAds });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
