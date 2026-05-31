"""handle_codex_command 전체 함수 교체"""
import re

p = "_company/_agents/secretary/tools/telegram_listener.py"
code = open(p, encoding="utf-8").read()

NEW_FUNC = '''
def handle_codex_command(query, token, chat_id):
    import html as _h, re as _re, json, urllib.request, urllib.parse
    nid = os.getenv('NAVER_CLIENT_ID')
    nsc = os.getenv('NAVER_CLIENT_SECRET')
    oai = os.getenv('OPENAI_API_KEY')
    def clean(t):
        return _re.sub(r'<[^>]+>', '', _h.unescape(t or '')).strip()
    sys_msg = (
        '한국주식 전문 뉴스 분석관. JSON만 응답:'
        'score(1-10),direction(긍정/부정/중립),stocks([종목]),summary(50자),reason(영향근거).'
        'score기준:9-10=실적/M&A,7-8=목표가/규제,5-6=업황,1-4=무관.'
        '시장:코스피최고치,AI반도체,HBM4,젠슨황방한,삼성전자노조'
    )
    try:
        q = urllib.parse.quote(query)
        req = urllib.request.Request(
            f'https://openapi.naver.com/v1/search/news.json?query={q}&display=5&sort=date',
            headers={'X-Naver-Client-Id': nid, 'X-Naver-Client-Secret': nsc})
        with urllib.request.urlopen(req, timeout=10) as r:
            items = json.loads(r.read()).get('items', [])
    except Exception as e:
        send_telegram_message(token, chat_id, f'코덱스 오류: {e}'); return
    if not items:
        send_telegram_message(token, chat_id, f"📭 '{query}' 뉴스 없음"); return
    results = []
    for item in items[:5]:
        title = clean(item.get('title', ''))
        desc  = clean(item.get('description', ''))
        link  = item.get('originallink') or item.get('link', '')
        try:
            data = json.dumps({
                'model': 'gpt-4o-mini', 'max_tokens': 150,
                'messages': [
                    {'role': 'system', 'content': sys_msg},
                    {'role': 'user',   'content': f'제목:{title}\\n요약:{desc}'}
                ]
            }).encode()
            req2 = urllib.request.Request(
                'https://api.openai.com/v1/chat/completions', data=data,
                headers={'Authorization': f'Bearer {oai}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req2, timeout=15) as r:
                raw = json.loads(r.read())['choices'][0]['message']['content']
                res = json.loads(_re.sub(r'```json|```', '', raw).strip())
            if int(res.get('score', 0)) >= 6:
                d      = res.get('direction', '중립')
                icon   = '📈' if d == '긍정' else '📉' if d == '부정' else '📊'
                stks   = ' '.join(res.get('stocks', []))
                score  = res.get('score', '?')
                reason = res.get('reason', '')
                msg    = f'📰 [{score}/10] {icon} {d}' + (f' | {stks}' if stks else '')
                msg   += f'\\n{res.get("summary", title)}'
                if reason: msg += f'\\n💡 {reason}'
                msg   += f'\\n🔗 {link}'
                results.append(msg)
        except:
            pass
    if results:
        send_telegram_message(token, chat_id,
            f"📰 코덱스 뉴스 — '{query}'\\n{'─'*20}\\n" + '\\n\\n'.join(results[:3]))
    else:
        send_telegram_message(token, chat_id, f"📭 '{query}' — 관련 뉴스 없음")
'''

# 기존 함수 전체 찾아서 교체
start = code.find('\ndef handle_codex_command(')
if start == -1:
    print("⚠️ 함수 못 찾음")
    exit(1)

# 다음 top-level def 찾기
rest = code[start + 1:]
m = re.search(r'\ndef \w+\(', rest)
end = start + 1 + (m.start() if m else len(rest))

new_code = code[:start] + NEW_FUNC + code[end:]
with open(p, 'w', encoding='utf-8') as f:
    f.write(new_code)

import ast
ast.parse(new_code)
print('✅ handle_codex_command 교체 완료')
