#!/usr/bin/env python3
"""코덱스 뉴스 귓뜸 v2 — 시장맥락·섹터맵·스코어링·출처신뢰도·과거흐름"""
import os, sys, json, html, re, hashlib, requests
from dotenv import load_dotenv
load_dotenv('.env')
NAVER_ID   = os.getenv('NAVER_CLIENT_ID')
NAVER_SEC  = os.getenv('NAVER_CLIENT_SECRET')
OPENAI_KEY = os.getenv('OPENAI_API_KEY')
TOKEN      = os.getenv('TELEGRAM_BOT_TOKEN')
CHAT_ID    = os.getenv('TELEGRAM_CHAT_ID')
STATE      = '_company/agents/stock_expert/news_state.json'
QUERIES    = ['코스피', '코스닥 주식', '반도체 주가', 'SK하이닉스', '삼성전자']
DRY        = '--dry' in sys.argv
SCORE_MIN  = 6

# ① 출처 신뢰도 목록
TRUSTED = ['연합뉴스','한국경제','조선비즈','머니투데이','이데일리',
           'investing.com','뉴스1','파이낸셜뉴스','thelec','thebell','한국일보']

# ① 시장 맥락 + ② 섹터-종목 지도 → 시스템 프롬프트
SYS_MSG = (
    "당신은 한국 주식시장 전문 뉴스 분석관입니다.\n"
    "[현재 시장 2026-05] 코스피 사상최고치 경신, AI반도체 랠리 주도, "
    "SK하이닉스 HBM4 16단 이슈, 젠슨황 방한, 삼성전자 노조이슈, 미국 금리동결 기조.\n"
    "[섹터-종목 지도] "
    "반도체/HBM: 삼성전자(005930) SK하이닉스(000660) | "
    "LED/광반도체: 서울반도체(046890) 서울바이오시스(092190) | "
    "2차전지: LG에너지솔루션(373220) 삼성SDI(006400) | "
    "AI인프라: 케이엠더블유 코위버 | 조선/방산: HD현대중공업(329180) 한화에어로(012450)\n"
    "JSON만 응답(다른 텍스트 절대 금지):\n"
    '{"score":1~10,"direction":"긍정/부정/중립","stocks":["영향종목"],'
    '"summary":"50자이내핵심","reason":"주가영향근거한줄"}\n'
    "score기준: 9-10=실적발표/인수합병, 7-8=목표가변경/수출규제, "
    "5-6=업황변화/업계이슈, 1-4=일반뉴스/무관"
)

def clean(t):
    return re.sub(r'<[^>]+>', '', html.unescape(t or '')).strip()

# ⑤ 과거 흐름 — seen URL + 최근 제목 목록 함께 저장
def load_seen():
    try:
        d = json.load(open(STATE))
        return set(d.get('seen', [])), d.get('titles', [])
    except:
        return set(), []

def save_seen(seen, titles):
    json.dump({'seen': list(seen)[-500:], 'titles': titles[-100:]}, open(STATE, 'w'))

# ⑤ 최근 30건 제목과 키워드 2개 이상 겹치면 반복 뉴스
def is_repeat(title, titles):
    words = set(w for w in title.split() if len(w) >= 2)
    for t in titles[-30:]:
        tw = set(w for w in t.split() if len(w) >= 2)
        if len(words & tw) >= 2:
            return True
    return False

# ⑥ 출처 신뢰도 — 비신뢰 출처 + 경계점수(6)면 스킵
def source_ok(link, score):
    trusted = any(s in link.lower() for s in TRUSTED)
    if not trusted and score <= SCORE_MIN:
        return False
    return True

def fetch_news():
    hdrs = {'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SEC}
    out = []
    for q in QUERIES:
        try:
            r = requests.get('https://openapi.naver.com/v1/search/news.json',
                params={'query': q, 'display': 20, 'sort': 'date'},
                headers=hdrs, timeout=10)
            if r.status_code == 200:
                out += r.json().get('items', [])
        except Exception as e:
            print(f'fetch 에러: {e}')
    return out

def art_id(a):
    url = a.get('originallink') or a.get('link', '')
    return hashlib.md5(url.encode()).hexdigest()

def analyze(title, desc):
    try:
        r = requests.post('https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {OPENAI_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': 'gpt-4o-mini', 'max_tokens': 150,
                  'messages': [{'role': 'system', 'content': SYS_MSG},
                               {'role': 'user', 'content': f'제목:{title}\n요약:{desc}'}]},
            timeout=15)
        raw = r.json()['choices'][0]['message']['content']
        return json.loads(re.sub(r'```json|```', '', raw).strip())
    except Exception as e:
        print(f'GPT 에러: {e}')
        return None

def send(text):
    if DRY:
        print(f'[미리보기]\n{text}\n')
        return
    requests.post(f'https://api.telegram.org/bot{TOKEN}/sendMessage',
        json={'chat_id': CHAT_ID, 'text': text}, timeout=10)

def main():
    seen, titles = load_seen()
    sent = 0
    for a in fetch_news():
        aid = art_id(a)
        if aid in seen:
            continue
        seen.add(aid)
        title = clean(a.get('title', ''))
        desc  = clean(a.get('description', ''))
        link  = a.get('originallink') or a.get('link', '')
        if is_repeat(title, titles):        # ⑤ 반복 뉴스 스킵
            continue
        res = analyze(title, desc)
        if not res:
            continue
        score = int(res.get('score', 0))
        if score < SCORE_MIN:               # ③ 점수 미달 스킵
            continue
        if not source_ok(link, score):      # ⑥ 출처 미달 스킵
            continue
        titles.append(title)
        d      = res.get('direction', '중립')
        icon   = '📈' if d == '긍정' else '📉' if d == '부정' else '📊'
        stks   = ' '.join(res.get('stocks', []))
        reason = res.get('reason', '')
        msg    = f'📰 코덱스 [{score}/10]\n{icon} {d}'
        msg   += f' | {stks}' if stks else ''
        msg   += f'\n{res.get("summary", title)}'
        msg   += f'\n💡 {reason}' if reason else ''  # ④ 근거
        msg   += f'\n🔗 {link}'
        send(msg)
        sent += 1
    save_seen(seen, titles)
    print(f'완료: {sent}건 발송')

if __name__ == '__main__':
    main()
