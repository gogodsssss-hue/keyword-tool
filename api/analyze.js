import crypto from 'crypto';

// ── 네이버 API 헬퍼 ──────────────────────────────────────────

// 네이버 DataLab - 상대 검색 인기도 (0~100)
async function naverDataLabTrend(keywords, cid, csec) {
  if (!cid || !csec || !keywords.length) return {};
  try {
    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);
    const startDate = new Date(today.setFullYear(today.getFullYear() - 1)).toISOString().slice(0, 10);
    // DataLab은 최대 5개씩
    const batches = [];
    for (let i = 0; i < keywords.length; i += 5) batches.push(keywords.slice(i, i + 5));
    const result = {};
    for (const batch of batches) {
      const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
        method: 'POST',
        headers: { 'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': csec, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate, endDate, timeUnit: 'month',
          keywordGroups: batch.map(k => ({ groupName: k, keywords: [k] }))
        })
      });
      if (!res.ok) continue;
      const d = await res.json();
      for (const r of (d.results || [])) {
        const avg = r.data.reduce((s, x) => s + x.ratio, 0) / (r.data.length || 1);
        result[r.title] = Math.round(avg);
      }
    }
    return result;
  } catch { return {}; }
}

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
      `${process.env.NAVER_AD_API_BASE_URL || 'https://api.naver.com'}/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`,
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
      `${process.env.NAVER_AD_API_BASE_URL || 'https://api.naver.com'}/keywordstool?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`,
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
    let errBody = {};
    try { errBody = await res.json(); } catch {}
    throw new Error(errBody.error?.message || `Claude API 오류 (${res.status})`);
  }
  const d = await res.json();
  const text = d.content?.[0]?.text || '';
  // JSON 파싱 시도 1: 그대로 파싱
  try { return JSON.parse(text); } catch {}
  // JSON 파싱 시도 2: 코드블록 제거 후 파싱
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  // JSON 파싱 시도 3: 첫 { ~ 마지막 } 추출
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // 파싱 완전 실패 → 원문 포함해서 에러
  throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
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
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // 줄임말 → 전체 단어 확장 (Naver Ad API가 줄임말을 못 찾는 경우 대비)
      const abbrevMap = {
        '주담대': '주택담보대출', '전세대': '전세자금대출', '신생아대': '신생아특례대출',
        '버팀목': '버팀목전세자금대출', '디딤돌': '디딤돌대출', '보금자리': '보금자리론',
        '청약': '아파트청약', '재건축': '재건축아파트', '갭투자': '갭투자방법',
        '종부세': '종합부동산세', '양도세': '양도소득세', '취득세': '취득세계산',
      };
      const fullTopic = abbrevMap[topic] || topic;

      // 1단계: 원어 + 확장어로 네이버 Ad API 연관 키워드 가져오기
      const relKws1 = hasAds ? await naverRelatedKeywords(topic, AD_KEY, AD_SECRET, AD_CUSTOMER) : [];
      await sleep(200);
      const relKws2 = (hasAds && fullTopic !== topic)
        ? await naverRelatedKeywords(fullTopic, AD_KEY, AD_SECRET, AD_CUSTOMER)
        : [];
      const relKwsAll = [...relKws1, ...relKws2];

      // 2단계: 검색량 있는 것 우선, 없어도 포함 (threshold 제거)
      const seen = new Set();
      let candidates = relKwsAll
        .filter(k => { if (seen.has(k.keyword)) return false; seen.add(k.keyword); return true; })
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // 관련 키워드가 부족하면 변형어로 직접 조회
      if (candidates.length < 5 && topic) {
        const suffixes = ['금리', '한도', '조건', '자격', '신청방법', '계산', '규제', '완화', '비교', '추천'];
        const extra = [topic, fullTopic, ...suffixes.map(s => `${fullTopic} ${s}`)];
        for (const v of extra) {
          if (seen.has(v)) continue;
          seen.add(v);
          const vol = hasAds ? await naverSearchVolume(v, AD_KEY, AD_SECRET, AD_CUSTOMER) : null;
          candidates.push({ keyword: v, pc: vol?.pc || 0, mobile: vol?.mobile || 0, total: vol?.total || 0 });
          await sleep(150);
          if (candidates.length >= 10) break;
        }
      }

      // 최소 1개는 보장
      if (!candidates.length) {
        candidates = [{ keyword: topic, pc: 0, mobile: 0, total: 0 }];
      }

      const withBlogCount = [];
      for (const k of candidates) {
        const bc = hasNaver
          ? await naverBlogSearch(k.keyword, NAVER_CID, NAVER_CSEC)
          : null;
        withBlogCount.push({ ...k, blogCount: bc });
        await sleep(150);
      }

      // DataLab 상대 인기도 (검색량 API 0일 때 대체 지표)
      const kwNames = withBlogCount.map(k => k.keyword);
      const trendMap = hasNaver ? await naverDataLabTrend(kwNames, NAVER_CID, NAVER_CSEC) : {};

      // 3단계: 황금도 계산
      // 검색량 있으면 (검색량/경쟁) 비율, 없으면 DataLab + 블로그경쟁으로만 판단
      const goldenScore = (vol, comp, trend) => {
        const v = vol   || 0;
        const c = comp  || 999999;
        const t = trend || 0;
        if (v > 0) {
          const ratio = v / (c + 1);
          if (ratio >= 1   && v >= 5000)  return 'A+';
          if (ratio >= 0.5 && v >= 2000)  return 'A';
          if (ratio >= 0.2 && v >= 1000)  return 'B+';
          if (ratio >= 0.1)               return 'B';
          if (v >= 5000)                  return 'B';
          return 'C';
        }
        // 검색량 없을 때: DataLab 인기도 + 블로그경쟁으로 판단
        if (t >= 30 && c <= 30000)   return 'A';
        if (t >= 20 && c <= 100000)  return 'B+';
        if (t >= 10 && c <= 300000)  return 'B';
        if (t >= 5  || c <= 200000)  return 'C+';
        return 'C';
      };
      const compLabel = c => c <= 10000 ? '낮음' : c <= 100000 ? '중간' : '높음';

      const scored = withBlogCount
        .map(k => {
          const trend = trendMap[k.keyword] || 0;
          const score = goldenScore(k.total, k.blogCount, trend);
          const volStr = k.total > 0 ? `월 ${k.total.toLocaleString()}회` : (trend > 0 ? `인기도 ${trend}/100` : '검색량 확인불가');
          return {
            keyword:       k.keyword,
            searchVolume:  k.total > 0 ? (k.total >= 10000 ? '높음' : k.total >= 2000 ? '중간' : '낮음') : (trend >= 20 ? '중간(추정)' : '낮음(추정)'),
            competition:   k.blogCount !== null ? compLabel(k.blogCount) : '조회불가',
            goldenScore:   score,
            monthlyPc:     k.pc,
            monthlyMobile: k.mobile,
            monthlyTotal:  k.total,
            trendScore:    trend,
            blogCount:     k.blogCount,
            reason: `${volStr} · 블로그 ${(k.blogCount ?? 0).toLocaleString()}개`
          };
        })
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
        try {
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
            if (extracted && (extracted.includes('명') || extracted.includes('개'))) {
              statsCtx = extracted.trim();
              extractedFromImage = true;
            }
          }
        } catch (imgErr) {
          // 이미지 분석 실패해도 계속 진행 (URL 기반 추정으로 대체)
          console.error('Vision 분석 실패(무시):', imgErr.message);
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
        `당신은 한국 블로그 SEO 전문가입니다.${topic ? ' ' + topic + ' 분야 전문.' : ''}
반드시 아래 JSON 형식만 반환하세요. 마크다운, 설명 텍스트 없이 순수 JSON만.

레벨 기준(0~10): 0=신생 1=입문 2=초보 3=성장 4=활성 5=중급 6=숙련 7=고급 8=전문가 9=파워블로거 10=최고권위
입력 수치 있으면 그것으로 판단, 없으면 URL로 추정.

{"estimatedLevel":3,"levelReason":"레벨 근거 1~2문장","scores":[{"label":"콘텐츠 품질","value":"B","sub":"평가"},{"label":"업로드 주기","value":"C","sub":"평가"},{"label":"이웃/방문자","value":"B","sub":"평가"},{"label":"키워드 최적화","value":"C","sub":"평가"},{"label":"SEO 구조","value":"B","sub":"평가"}],"growthBlockers":[{"rank":1,"title":"원인제목","diagnosis":"진단 2문장","action":"구체적 행동"},{"rank":2,"title":"원인제목","diagnosis":"진단","action":"행동"},{"rank":3,"title":"원인제목","diagnosis":"진단","action":"행동"}],"nextLevelTips":["조건1","조건2","조건3"],"summary":"종합 브리핑 3~4문장","tips":["전략1","전략2","전략3","전략4","전략5"]}`,
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
- 분석 요약: ${ctx.customContext || ctx.summary || ''}
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
      const rawUrl = (blogUrl || '').trim();
      const cleanUrl = rawUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      const isNaver = /^blog\.naver\.com\//i.test(cleanUrl);
      const isTistory = /\.tistory\.com/i.test(cleanUrl) || (!isNaver && !cleanUrl.includes('blog.naver.com'));

      if (!cleanUrl) return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });

      // RSS URL 결정
      let rssUrl;
      if (isNaver) {
        const blogId = cleanUrl.replace(/^blog\.naver\.com\//i, '').replace(/\/$/, '');
        rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
      } else {
        // 티스토리 또는 커스텀 도메인: /rss 시도
        const base = `https://${cleanUrl}`;
        rssUrl = `${base}/rss`;
      }

      const blogId = isNaver
        ? cleanUrl.replace(/^blog\.naver\.com\//i, '').replace(/\/$/, '')
        : cleanUrl.split('/')[0];

      // RSS 가져오기
      const rssRes = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' }
      });
      if (!rssRes.ok) return res.status(400).json({ error: `RSS 불러오기 실패 (${rssRes.status}). 네이버 블로그는 아이디만, 티스토리는 전체 주소를 입력해주세요.` });
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
        // 제목에서 의미있는 단어 추출 (개별 명사, 2단어 억지 조합 X)
        const stopWords = new Set(['이다','있다','없다','하다','되다','오늘','내일','이번','다음','그냥','아직','정말','매우','너무','가장','많이','그리고','하지만','그래서','위해','통해','대해','함께','이후','이전','분석','정리','총정리','완벽','최신','심층','방문','감사','공유','내용','발표','보완','대책','오를까','오르나','왜','꼭','알아야','들의','잃은','넘을까','바로','모든','중','정도','관련','경우','또한','그러나','따라서','때문','같은','새로운','좋은','나쁜','높은','낮은','많은','적은','큰','작은','된다','최근','지금','올해']);
        const rawWords = title.split(/[\s,·[\]「」『』【】《》<>()（）""''!?！？…·•\/\\|@#$%^&*+=~`—\-]+/).filter(Boolean);
        const titleKeywords = [...new Set(
          rawWords
            .map(w => w
              .replace(/^[^가-힣a-zA-Z0-9]+|[^가-힣a-zA-Z0-9]+$/g, '')
              .replace(/(은|는|이|가|을|를|의|에|로|도|만|와|과|서|며|나|랑|인데|이고|하고|한데|으로|에서|부터|까지|에게|한테|이란|이면|이든|이나|거나|지만|라도|라서|라고|이라|다면|다고|다는|이는|한다|된다|된|한|들의|들도|들은|들이|들을)$/, ''))
            .filter(w => w.length >= 2 && /[가-힣]/.test(w) && !stopWords.has(w))
        )].slice(0, 5);
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
        const kwsToCheck = allKeywords.slice(0, 8);
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

      // AI 코치: 각 포스트에 SEO 개선 제안
      let aiSuggestions = [];
      if (CLAUDE_KEY && posts.length > 0) {
        try {
          const postTitles = posts.slice(0, 10).map((p, i) => `${i}. ${p.title}`).join('\n');
          const aiCoachRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 1500,
              system: '네이버 블로그 SEO 전문가. JSON 배열만 출력. 다른 텍스트 없이.',
              messages: [{ role: 'user', content: `블로그 포스트 제목들을 분석해서 SEO 코칭을 JSON으로 주세요.

형식 (반드시 이 형식만):
[{"idx":0,"type":"뉴스성","issue":"날짜가 포함되어 시간이 지나면 검색이 안됩니다","betterTitle":"주담대 금리 오르는 이유와 대처법","keyword":"주담대 금리"}]

type: "뉴스성"(시사·날짜 포함, 유통기한 짧음) / "상록성"(시간 지나도 검색됨) / "혼합"
issue: 왜 검색이 어려운지 한 문장 (뉴스성이면 솔직하게)
betterTitle: 같은 주제지만 검색에 더 오래 살아남을 제목
keyword: 핵심 타깃 키워드 1개

포스트 목록:
${postTitles}` }]
            })
          });
          if (aiCoachRes.ok) {
            const aiCoachData = await aiCoachRes.json();
            const raw = aiCoachData.content?.[0]?.text || '[]';
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) aiSuggestions = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          // AI 코치 실패 시 기본 제안 생성
          aiSuggestions = posts.slice(0, 10).map((p, i) => {
            const hasDate = /\d{4}년|\d{1,2}월|\d{1,2}일|오늘|어제|최신|최근/.test(p.title);
            const type = hasDate ? '뉴스성' : '혼합';
            return {
              idx: i,
              type,
              issue: hasDate ? '날짜·시사성 표현이 포함되어 시간이 지나면 검색이 안됩니다' : '검색에 오래 노출되려면 제목을 다듬을 여지가 있습니다',
              betterTitle: p.title.replace(/\d{4}년\s*\d{1,2}월\d{1,2}일\s*/g, '').replace(/최신\s*/g, '').trim(),
              keyword: p.keywords?.[0]?.keyword || ''
            };
          });
        }
      }

      result = { posts: enrichedPosts, bestKeywords, blogId, totalPosts: posts.length, aiSuggestions };
    }

    // 키워드 실데이터 조회 (AI 없음 — 네이버 API 직접)
    else if (mode === 'kw-checker') {
      const keywords = (req.body.keywords || []).slice(0, 10);
      if (!keywords.length) return res.status(400).json({ error: '키워드를 입력해주세요.' });

      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const rows = [];
      for (const kw of keywords) {
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
        await sleep(300);
      }

      // Ad API가 모두 null이면 DataLab으로 상대 트렌드 보완
      const allNull = rows.every(r => r.total === null);
      if (allNull && hasNaver) {
        const trends = await naverDataLabTrend(keywords, NAVER_CID, NAVER_CSEC);
        for (const r of rows) {
          if (trends[r.keyword] != null) r.trendScore = trends[r.keyword]; // 0~100
        }
      }

      result = { rows };
    }

    // ⑱ 상위 블로거 수집 — 분야 키워드로 자주 등장하는 블로거 목록
    else if (mode === 'top-bloggers') {
      if (!hasNaver) return res.status(400).json({ error: '네이버 API가 필요합니다.' });
      if (!topic) return res.status(400).json({ error: '주제를 입력해주세요.' });

      // 관련 키워드 5개 생성 (주제 변형)
      const searchQueries = [
        topic,
        `${topic} 방법`,
        `${topic} 정리`,
        `${topic} 최신`,
        `${topic} 분석`
      ];

      // 각 키워드로 상위 30개씩 검색
      const allItems = [];
      for (const q of searchQueries) {
        const r = await naverBlogSearchItems(q, NAVER_CID, NAVER_CSEC, 30);
        if (r?.items) allItems.push(...r.items);
        await new Promise(res => setTimeout(res, 200));
      }

      // 블로거별 등장 횟수 집계
      const bloggerMap = {};
      const strip = s => (s || '').replace(/<[^>]*>/g, '').trim();
      for (const item of allItems) {
        const link = item.bloggerlink || '';
        const name = item.bloggername || '';
        if (!link || link.includes('post.naver') || link.includes('cafe.naver')) continue;
        const key = link.toLowerCase().replace(/\/$/, '');
        if (!bloggerMap[key]) {
          bloggerMap[key] = { name: strip(name), link, count: 0, titles: [] };
        }
        bloggerMap[key].count++;
        if (bloggerMap[key].titles.length < 3) {
          bloggerMap[key].titles.push(strip(item.title).slice(0, 40));
        }
      }

      // 등장 횟수 순 정렬
      const bloggers = Object.values(bloggerMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);

      result = { bloggers, topic, total: bloggers.length };
    }

    // ⑲ 순위 체커 — 키워드 검색 시 내 블로그 몇 위?
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

    // ⑳ 블로그 비교 분석
    else if (mode === 'blog-compare') {
      const myBlogUrl   = req.body.myBlogUrl   || '';
      const compBlogUrl = req.body.compBlogUrl || '';
      if (!myBlogUrl || !compBlogUrl) return res.status(400).json({ error: '두 블로그 URL을 모두 입력해주세요.' });

      const extractId = url => url.replace(/^https?:\/\//i,'').replace(/^blog\.naver\.com\//i,'').replace(/\/$/,'').split('/')[0].toLowerCase();
      const myId   = extractId(myBlogUrl);
      const compId = extractId(compBlogUrl);
      const strip  = s => (s || '').replace(/<[^>]*>/g,'').trim();

      // RSS 피드로 포스트 직접 수집
      const fetchBlogRss = async (blogId) => {
        try {
          const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (!res.ok) return [];
          const xml = await res.text();
          const items = [];
          const itemReg = /<item>([\s\S]*?)<\/item>/g;
          let m;
          while ((m = itemReg.exec(xml)) !== null) {
            const block = m[1];
            const title   = strip((block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '');
            const link    = strip((block.match(/<link>(.*?)<\/link>/) || [])[1] || '');
            const pubDate = strip((block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '');
            if (title) items.push({ title, link, date: pubDate });
          }
          return items;
        } catch { return []; }
      };

      const [myPosts, compPosts] = await Promise.all([
        fetchBlogRss(myId),
        fetchBlogRss(compId)
      ]);

      // 제목에서 주요 키워드 추출
      const extractKws = (posts) => {
        const freq = {};
        const stopW = new Set(['있는','없는','하는','이런','저런','그런','에서','으로','에게','부터','까지','이란','이라','이며','그리고','하지만','그래서','때문','경우','관련','정도','이상','이하','위해','통해','대한','있어','없어','합니다','됩니다','있습니다','없습니다']);
        for (const p of posts) {
          const words = p.title.split(/[\s\[\]()「」『』【】《》<>""''!?…·•\/\\|@#$%^&*+=~\-,]+/).filter(Boolean);
          for (const w of words) {
            const clean = w.replace(/(은|는|이|가|을|를|의|에|로|도|만|와|과|서|며|나|랑|인데|이고|하고)$/, '').trim();
            if (clean.length >= 2 && /[가-힣]/.test(clean) && !stopW.has(clean)) {
              freq[clean] = (freq[clean] || 0) + 1;
            }
          }
        }
        return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,30).map(([kw,cnt]) => ({ kw, cnt }));
      };

      const myKws   = extractKws(myPosts);
      const compKws = extractKws(compPosts);
      const myKwSet = new Set(myKws.map(k => k.kw));
      const gapKws  = compKws.filter(k => !myKwSet.has(k.kw)).slice(0, 15);

      // 날짜 분포 (최근 6개월)
      const dateFreq = (posts) => {
        const m = {};
        for (const p of posts) {
          // pubDate: "Wed, 30 Apr 2026 10:00:00 +0900"
          const d = new Date(p.date);
          if (isNaN(d)) continue;
          const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
          m[ym] = (m[ym]||0)+1;
        }
        return Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0])).slice(-6).map(([ym,cnt])=>({ym,cnt}));
      };

      // Claude 분석
      let aiAnalysis = '';
      if (CLAUDE_KEY && (myPosts.length || compPosts.length)) {
        const myTitles   = myPosts.slice(0,20).map(p=>p.title).join('\n') || '(포스트 없음)';
        const compTitles = compPosts.slice(0,20).map(p=>p.title).join('\n') || '(포스트 없음)';
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{'x-api-key':CLAUDE_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
          body: JSON.stringify({
            model:'claude-haiku-4-5', max_tokens:700,
            messages:[{ role:'user', content:
              `네이버 블로그 두 개를 비교해줘. 한국어로 답변.\n\n내 블로그(${myId}) 최근 포스트 제목:\n${myTitles}\n\n경쟁 블로그(${compId}) 최근 포스트 제목:\n${compTitles}\n\n다음을 분석해줘 (각 항목 1~2줄):\n1. 경쟁 블로그의 강점\n2. 내 블로그가 따라야 할 전략\n3. 내가 당장 써야 할 키워드/주제 3가지 (번호 목록)`
            }]
          })
        });
        if (aiRes.ok) {
          const aiJson = await aiRes.json();
          aiAnalysis = aiJson.content?.[0]?.text || '';
        }
      }

      result = {
        myId, compId,
        myCount:    myPosts.length,
        compCount:  compPosts.length,
        myKws:      myKws.slice(0,15),
        compKws:    compKws.slice(0,15),
        gapKws,
        myDates:    dateFreq(myPosts),
        compDates:  dateFreq(compPosts),
        myRecent:   myPosts.slice(0,5),
        compRecent: compPosts.slice(0,5),
        aiAnalysis
      };
    }

    // 블로그 비교 대화
    else if (mode === 'cmp-chat') {
      const userMsg  = req.body.message || '';
      const context  = req.body.context || '';
      const modelReq = req.body.model || 'haiku';
      const modelId  = modelReq === 'sonnet' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';
      if (!userMsg) return res.status(400).json({ error: '메시지가 없습니다.' });

      const chatRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 600,
          system: `당신은 한국 블로그 SEO 전문 코치입니다. 짧고 솔직하게 3~5문장으로 답하세요. 한국어로.${context ? '\n\n[블로그 비교 데이터]\n' + context : ''}`,
          messages: [{ role: 'user', content: userMsg }]
        })
      });
      if (!chatRes.ok) {
        const e = await chatRes.json();
        return res.status(chatRes.status).json({ error: e.error?.message || 'Claude API 오류' });
      }
      const chatData = await chatRes.json();
      return res.status(200).json({ reply: chatData.content?.[0]?.text || '' });
    }

    // 실거래가 조회 (국토교통부 API)
    else if (mode === 'realestate-deals') {
      const { region, dealType, yearMonth, complexFilter } = req.body;
      const MOLIT_KEY = process.env.MOLIT_API_KEY;

      if (!MOLIT_KEY) return res.status(500).json({ error: '국토부 API 키가 설정되지 않았습니다. (MOLIT_API_KEY)' });
      if (!region) return res.status(400).json({ error: '지역을 선택해주세요.' });
      if (!yearMonth) return res.status(400).json({ error: '거래월을 입력해주세요.' });

      const endpoint = dealType === 'rent'
        ? 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'
        : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

      const url = `${endpoint}?serviceKey=${MOLIT_KEY}&LAWD_CD=${region}&DEAL_YMD=${yearMonth}&numOfRows=1000&pageNo=1`;

      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KeywordTool/1.0)' }
        });
        if (!r.ok) return res.status(502).json({ error: `국토부 API 오류 (${r.status})` });
        const xml = await r.text();

        // XML 파싱
        const items = [];
        const itemRe = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = itemRe.exec(xml)) !== null) {
          const block = m[1];
          const get = tag => {
            const t = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            return t ? t[1].trim() : '';
          };

          if (dealType === 'rent') {
            const deposit = get('deposit');
            const monthlyRent = get('monthlyRent');
            items.push({
              단지명: get('aptNm'),
              법정동: get('umdNm'),
              전용면적: parseFloat(get('excluUseAr')) || 0,
              층: get('floor'),
              건축년도: get('buildYear'),
              보증금: deposit,
              월세: monthlyRent,
              구분: (monthlyRent === '0' || !monthlyRent) ? '전세' : '월세',
              계약년: get('dealYear'),
              계약월: get('dealMonth'),
              계약일: get('dealDay'),
              계약기간: get('contractTerm') || '',
              계약구분: get('contractType') || ''
            });
          } else {
            items.push({
              단지명: get('aptNm'),
              법정동: get('umdNm'),
              지번: get('jibun'),
              도로명: `${get('roadNm') || ''} ${get('roadNmBonbun') || ''}${get('roadNmBubun') ? '-'+get('roadNmBubun') : ''}`.trim(),
              전용면적: parseFloat(get('excluUseAr')) || 0,
              층: get('floor'),
              건축년도: get('buildYear'),
              거래금액: get('dealAmount').replace(/,/g, '').trim(),
              계약년: get('dealYear'),
              계약월: get('dealMonth'),
              계약일: get('dealDay'),
              거래유형: get('dealingGbn') || '',
              해제여부: get('cdealType') === 'O' ? '해제' : ''
            });
          }
        }

        // 단지명 필터
        let filtered = items;
        if (complexFilter && complexFilter.trim()) {
          const f = complexFilter.trim().toLowerCase();
          filtered = items.filter(i => (i.단지명 || '').toLowerCase().includes(f));
        }

        // 거래일 최신순 정렬
        filtered.sort((a, b) => {
          const da = `${a.계약년}${(a.계약월||'').padStart(2,'0')}${(a.계약일||'').padStart(2,'0')}`;
          const db = `${b.계약년}${(b.계약월||'').padStart(2,'0')}${(b.계약일||'').padStart(2,'0')}`;
          return db.localeCompare(da);
        });

        result = {
          deals: filtered,
          total: filtered.length,
          totalRaw: items.length,
          region,
          yearMonth,
          dealType
        };
      } catch (e) {
        return res.status(500).json({ error: '국토부 API 호출 실패: ' + e.message });
      }
    }

    else {
      return res.status(400).json({ error: '지원하지 않는 모드입니다.' });
    }

    return res.status(200).json({ ...result, _hasNaver: hasNaver, _hasAds: hasAds });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
