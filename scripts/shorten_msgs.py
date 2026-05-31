"""영숙 봇 메시지 단축 패치"""
p = "_company/_agents/secretary/tools/telegram_listener.py"
code = open(p, encoding="utf-8").read()
count = 0

replacements = [
    (
        '명령을 확인했습니다. **\'{query}\'** 주제에 대한 언론사 공식 뉴스 실시간 수집 및 다차원 교차 검증(Fact-Check)을 개시합니다. 잠시만 대기해 주십시오...',
        "코덱스 | '{query}' 뉴스 검색 중..."
    ),
    (
        '구글 공식 뉴스 RSS 피드 파이프라인에서 데이터를 100% 포착했습니다. 분석을 개시합니다...',
        '코덱스 | 구글뉴스RSS 수집 완료'
    ),
    (
        '백업망: Tavily API 실시간 연구엔진을 기동합니다...',
        '코덱스 | Tavily 백업망 가동'
    ),
    (
        '최종 응답 생성 실패: API 통신 지연 또는 오류 발생.',
        '코덱스 오류 — API 통신 실패'
    ),
    (
        "📰 대표님, 요청하신 언론사 공식 뉴스를 '구글 공식 RSS 파이프라인'에서 즉각 추적 중입니다...",
        '📰 코덱스 | 뉴스 검색 중...'
    ),
    (
        "⚙️ 대표님, 요청하신 '{query}'에 대한 초고속 실시간 조사를 개시합니다. 잠시만 대기해 주십시오...",
        "⚙️ 코덱스 | '{query}' 조사 중..."
    ),
    (
        '📱 **수석 비서 영숙(Youngsook) 파이프라인 전면 개조 완료**\n\n대표님, 과금 0원의 가장 완벽한 언론사망 **[구글 공식 뉴스 RSS 파이프라인]**이 영숙이 심장부에 1순위로 장착되었습니다. \n\n이제 "오늘 코인 뉴스 알려줘" 라고 던지시면 가짜 템플릿 없이 실제 신문사 링크를 즉시 물어옵니다!',
        '📱 영숙 | 뉴스RSS 파이프라인 가동 완료'
    ),
]

for old, new in replacements:
    if old in code:
        code = code.replace(old, new, 1)
        count += 1
        print(f"✅ 교체: {new[:30]}...")
    else:
        print(f"⚠️ 못 찾음: {old[:30]}...")

open(p, "w", encoding="utf-8").write(code)
import ast; ast.parse(code)
print(f"\n완료: {count}건 단축")
