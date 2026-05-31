"""telegram_listener.py 안의 handle_codex_command를 v2로 업그레이드"""
import re

p = "_company/_agents/secretary/tools/telegram_listener.py"
code = open(p, encoding="utf-8").read()

# v2 SYS_MSG
NEW_SYS = (
    "한국 주식 전문 뉴스 분석관. JSON만 응답(다른 텍스트 금지):\\n"
    "[시장2026-05] 코스피최고치,AI반도체랠리,SK하이닉스HBM4,젠슨황방한,삼성전자노조,금리동결\\n"
    "[섹터] 반도체:삼성전자(005930) SK하이닉스(000660)|LED:서울반도체(046890)|2차전지:LG에너지(373220) 삼성SDI(006400)\\n"
    '{"score":1~10,"direction":"긍정/부정/중립","stocks":["종목"],"summary":"50자이내","reason":"영향근거"}\\n'
    "score: 9-10=실적/인수합병, 7-8=목표가/규제, 5-6=업황, 1-4=무관"
)

# 1. sys_msg 교체
old_sysmsg = """    sys_msg = '한국 주식 전문가. JSON만: {"important":true/false,"direction":"긍정/부정/중립","stocks":["종목"],"summary":"50자이내"}'"""
new_sysmsg = f'    sys_msg = ("{NEW_SYS}")'
if old_sysmsg in code:
    code = code.replace(old_sysmsg, new_sysmsg, 1)
    print("sys_msg 교체 완료")
else:
    print("⚠️ sys_msg 앵커 못 찾음")

# 2. max_tokens 120 → 150
code = code.replace("'max_tokens':120,'messages':[", "'max_tokens':150,'messages':[", 1)
print("max_tokens 업데이트")

# 3. important → score 기반
old_check = "            if res.get('important'):"
new_check = "            if int(res.get('score', 0)) >= 6:"
if old_check in code:
    code = code.replace(old_check, new_check, 1)
    print("score 기반 필터 교체")
else:
    print("⚠️ important 체크 앵커 못 찾음")

# 4. 메시지 포맷에 score + reason 추가
old_msg = """                icon = '📈' if d=='긍정' else '📉' if d=='부정' else '📊'
                stks = ' '.join(res.get('stocks',[]))
                msg = f"{icon} {d}" + (f" | {stks}" if stks else '')
                msg += f"\\n{res.get('summary',title)}\\n🔗 {link}"
                results.append(msg)"""
new_msg = """                icon = '📈' if d=='긍정' else '📉' if d=='부정' else '📊'
                stks = ' '.join(res.get('stocks',[]))
                score = res.get('score','?')
                reason = res.get('reason','')
                msg = f"📰 코덱스 [{score}/10]\\n{icon} {d}" + (f" | {stks}" if stks else '')
                msg += f"\\n{res.get('summary',title)}"
                msg += f"\\n💡 {reason}" if reason else ''
                msg += f"\\n🔗 {link}"
                results.append(msg)"""
if old_msg in code:
    code = code.replace(old_msg, new_msg, 1)
    print("메시지 포맷 업데이트")
else:
    print("⚠️ 메시지 포맷 앵커 못 찾음")

# 헤더 제목도 수정
code = code.replace(
    'send_telegram_message(token, chat_id, f"📰 코덱스 — \'{query}\'\\n{\'─\'*18}\\n" + \'\\n\\n\'.join(results[:3]))',
    'send_telegram_message(token, chat_id, f"📰 코덱스 뉴스 — \'{query}\'\\n{\'─\'*20}\\n" + \'\\n\\n\'.join(results[:3]))',
    1
)

with open(p, "w", encoding="utf-8") as f:
    f.write(code)

import ast
ast.parse(code)
print("문법 OK — 패치 완료")
