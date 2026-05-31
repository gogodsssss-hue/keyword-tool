"""코덱스 자연어 쿼리 → 키워드 자동 추출 패치"""
p = "_company/_agents/secretary/tools/telegram_listener.py"
code = open(p, encoding="utf-8").read()

# 1. extract_search_keywords 함수를 google_news_search 함수 앞에 추가
NEW_FUNC = '''
def extract_search_keywords(query, oai_key):
    """자연어 쿼리 → 검색 키워드 2-3개 추출"""
    if len(query) <= 12:
        return query
    import json, urllib.request
    try:
        data = json.dumps({
            'model': 'gpt-4o-mini', 'max_tokens': 20,
            'messages': [
                {'role': 'system', 'content': '뉴스 검색 키워드 2-3개만 공백 구분 출력. 다른 말 금지.'},
                {'role': 'user', 'content': query}
            ]
        }).encode()
        req = urllib.request.Request(
            'https://api.openai.com/v1/chat/completions', data=data,
            headers={'Authorization': f'Bearer {oai_key}', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())['choices'][0]['message']['content'].strip()
            return result if result else query
    except:
        return query

'''

# google_news_search 함수 앞에 삽입
anchor = '\ndef google_news_search('
if anchor in code:
    idx = code.find(anchor)
    code = code[:idx] + NEW_FUNC + code[idx:]
    print('① extract_search_keywords 함수 추가 완료')
else:
    print('⚠️ google_news_search 앵커 못 찾음')

# 2. 검색 전에 키워드 추출 삽입
old2 = '        res = google_news_search(query)'
new2 = ('        search_query = extract_search_keywords(query, openai_key)\n'
        '        if search_query != query:\n'
        "            send_telegram_message(token, chat_id, f'🔑 키워드: {search_query}')\n"
        '        res = google_news_search(search_query)')
if old2 in code:
    code = code.replace(old2, new2, 1)
    print('② google_news_search 키워드 적용 완료')
else:
    print('⚠️ google_news_search 호출 앵커 못 찾음')

# 3. tavily도 search_query 사용
old3 = '                res = tavily_search(query, tavily_key)'
new3 = '                res = tavily_search(search_query, tavily_key)'
if old3 in code:
    code = code.replace(old3, new3, 1)
    print('③ tavily_search 키워드 적용 완료')

with open(p, 'w', encoding='utf-8') as f:
    f.write(code)

import ast
ast.parse(code)
print('✅ 문법 OK — 패치 완료')
