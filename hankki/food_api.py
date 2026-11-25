"""Name lookup in the MFDS Food Nutrient Database."""
import json
import math
import os
import re
from http.server import SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen

ENDPOINT = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03"
FIELDS = {"energy": 1, "carbs": 6, "protein": 3, "fat": 4, "fiber": 8, "sodium": 13}


def convert(row):
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s*g", str(row.get("SERVING_SIZE", "")).strip(), re.I)
    name = row.get("FOOD_NM_KR")
    code = str(row.get("FOOD_CD", ""))
    if not match or not float(match[1]) or not name or not re.fullmatch(r"[A-Za-z0-9_-]+", code):
        return None
    values = {}
    for key, field in FIELDS.items():
        try:
            value = float(str(row["AMT_NUM" + str(field)]).replace(",", "")) * 100 / float(match[1])
            values[key] = value if math.isfinite(value) and value >= 0 else None
        except (KeyError, ValueError):
            values[key] = None
    if values["energy"] is None:
        return None
    maker = row.get("MAKER_NM")
    if maker and maker not in ("해당없음", "-"):
        name += " (" + maker + ")"
    return dict(id="mfds-" + code, name=name, values=values, serving=None)


class FoodHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        if route.path.rstrip("/") != "/api/foods":
            return super().do_GET()
        term = parse_qs(route.query).get("q", [""])[0].strip()
        key = os.environ.get("MFDS_API_KEY", "").strip()
        if not key:
            return self.reply(503, {"error": "서버에 MFDS_API_KEY를 설정한 뒤 다시 실행해 주세요."})
        if not 1 <= len(term) <= 60:
            return self.reply(400, {"error": "음식 이름을 1~60자로 입력해 주세요."})
        params = urlencode(dict(serviceKey=key, type="json", FOOD_NM_KR=term, pageNo=1, numOfRows=100))
        try:
            with urlopen(ENDPOINT + "?" + params, timeout=8) as response:
                data = json.load(response)
            data = data.get("response", data)
            if str(data.get("header", {}).get("resultCode", "")) not in ("00", "0", "0000"):
                raise ValueError("API response")
            items = data["body"].get("items") or []
            if isinstance(items, dict):
                items = items.get("item") or []
            if isinstance(items, dict):
                items = [items]
            foods = [food for row in items if (food := convert(row))]
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            return self.reply(502, {"error": "공공데이터 조회에 실패했어요. 인증키의 승인 상태와 연결을 확인해 주세요."})
        return self.reply(200, {"foods": foods})

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
