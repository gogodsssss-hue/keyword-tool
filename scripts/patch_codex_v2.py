"""handle_codex_command v2 패치 — 따옴표 안전 버전"""

p = "_company/_agents/secretary/tools/telegram_listener.py"
code = open(p, encoding="utf-8").read()

# 1. sys_msg 교체 — repr() 사용으로 따옴표 충돌 방지
SYS = (
    '한국주식 전문 뉴스 분석관. JSON만 응답(다른 텍스트 금지):\n'
    '[시장2026-05] 코스피최고치,AI반도체랠리,HBM4,젠슨황방한,삼성전자노조,금리동결\n'
    '[섹터] 반도체:삼성전자(005930) SK하이닉스(000660)|LED:서울반도체(046890)|2차전지:LG에너지(373220)\n'
    'JSON: score(1-10),direction(긍정/부정/중립),stocks([종목]),summary(50자),reason(영향근거)\n'
    'score기준: 9-10=실적/인수합병, 7-8=목표가/규제, 5-6=업황, 1-4=무관'
)

old1 = """    sys_msg = '한국 주식 전문가. JSON만: {"important":true/false,"direction":"긍정/부정/중립","stocks":["종목"],"summary":"50자이내"}'"""
new1 = "    sys_msg = " + repr(SYS)

if old1 in code:
    code = code.replace(old1, new1, 1)
    print("① sys_msg 교체 완료")
else:
    print("⚠️ sys_msg 앵커 못 찾음")

# 2. max_tokens
if "'max_tokens':120," in code:
    code = code.replace("'max_tokens':120,", "'max_tokens':150,", 1)
    print("② max_tokens 150 완료")

# 3. important → score 기반
old3 = "            if res.get('important'):"
new3 = "            if int(res.get('score', 0)) >= 6:"
if old3 in code:
    code = code.replace(old3, new3, 1)
    print("③ score 필터 완료")
else:
    print("⚠️ important 앵커 못 찾음")

# 4. 메시지 포맷 — score + reason 추가
old4 = "                stks = ' '.join(res.get('stocks',[]))\n                msg = "
new4 = "                stks = ' '.join(res.get('stocks',[]))\n                score = res.get('score','?')\n                reason = res.get('reason','')\n                msg = "
if old4 in code:
    code = code.replace(old4, new4, 1)
    print("④ 메시지 스코어 변수 추가 완료")

old5 = '                msg += f"\\n{res.get(\'summary\',title)}\\n🔗 {link}"\n                results.append(msg)'
new5 = '                msg += f"\\n{res.get(\'summary\',title)}"\n                if reason: msg += f"\\n💡 {reason}"\n                msg += f"\\n🔗 {link}"\n                results.append(msg)'
if old5 in code:
    code = code.replace(old5, new5, 1)
    print("⑤ 메시지 reason 추가 완료")

with open(p, "w", encoding="utf-8") as f:
    f.write(code)

import ast
ast.parse(code)
print("✅ 문법 OK — 패치 완료")
