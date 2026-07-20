"""실황 슬롯 치환(R2-01 §3.3, S3) 단위 테스트 — 순수 함수만, DB·Redis 불필요.

extract_slot_values: weather 캐시(dict)에서 §3.3 허용 슬롯 5종 값 추출.
fill_live_slots: template_json 문자열 필드의 {today.*} 치환 + 성공 여부.
"""
from app.services.session_service import extract_slot_values, fill_live_slots

WEATHER = {
    "region": "서울",
    "forecasts": [
        {"datetime": "202607190600", "TMP": 24.0, "SKY": 1.0, "POP": 10.0},
        {"datetime": "202607190900", "TMP": 27.0, "SKY": 3.0, "POP": 30.0},
        {"datetime": "202607191200", "TMP": 29.0, "TMX": 30.0, "SKY": 3.0, "POP": 60.0},
        {"datetime": "202607191500", "TMP": 28.0, "TMN": 23.0, "SKY": 3.0, "POP": 20.0},
    ],
}


class TestExtractSlotValues:
    def test_허용_슬롯_5종_모두_추출(self):
        values = extract_slot_values(WEATHER)
        assert values["today.region"] == "서울"
        assert values["today.temp_max"] == "30"  # TMX 우선
        assert values["today.temp_min"] == "23"  # TMN 우선
        assert values["today.rain_prob"] == "60"  # POP 최대값
        assert values["today.sky"] == "구름많음"  # SKY 최빈값(3)

    def test_TMX_TMN_없으면_TMP_최대_최소로_대체(self):
        weather = {
            "region": "부산",
            "forecasts": [
                {"datetime": "202607190600", "TMP": 22.0},
                {"datetime": "202607191200", "TMP": 28.5},
            ],
        }
        values = extract_slot_values(weather)
        assert values["today.temp_max"] == "28.5"
        assert values["today.temp_min"] == "22"

    def test_빈_날씨는_빈_dict(self):
        assert extract_slot_values({}) == {}


class TestFillLiveSlots:
    SLOT_VALUES = {
        "today.temp_max": "30",
        "today.temp_min": "23",
        "today.sky": "구름많음",
        "today.rain_prob": "60",
        "today.region": "서울",
    }

    def test_question_text_options_정답까지_치환(self):
        template = {
            "question_text": "오늘 {today.region} 최고기온은 {today.temp_max}도, 하늘은 {today.sky}였다. 강수확률은?",
            "options": ["{today.rain_prob}%", "10%", "5%", "0%"],
            "correct_answer": "{today.rain_prob}%",
        }
        rendered, ok = fill_live_slots(template, self.SLOT_VALUES)
        assert ok is True
        assert rendered["question_text"] == "오늘 서울 최고기온은 30도, 하늘은 구름많음였다. 강수확률은?"
        assert rendered["options"][0] == "60%"
        assert rendered["correct_answer"] == "60%"

    def test_원본_template은_불변(self):
        template = {"question_text": "{today.temp_max}도"}
        fill_live_slots(template, self.SLOT_VALUES)
        assert template["question_text"] == "{today.temp_max}도"

    def test_값_없는_슬롯이_있으면_실패_반환(self):
        template = {"question_text": "{today.temp_max}도, {today.sky}"}
        rendered, ok = fill_live_slots(template, {"today.temp_max": "30"})
        assert ok is False  # 호출측이 quiz-generate 폴백 (§3.2)
        assert "{today.sky}" in rendered["question_text"]  # 미치환 원문 유지

    def test_슬롯_없는_template은_그대로_성공(self):
        template = {"question_text": "저기압이 다가오면?", "correct_answer": "흐려진다"}
        rendered, ok = fill_live_slots(template, {})
        assert ok is True
        assert rendered == template
