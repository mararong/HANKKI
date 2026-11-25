"""Name lookup in the MFDS Food Nutrient Database."""
import json
import math
import os
import re
import time
from functools import lru_cache
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
    return dict(id="mfds-" + code, name=name, values=values, serving=None)


def normalized(name):
    return "".join(name.casefold().split())


# Everyday menu names can differ from the database's dish_ingredient notation.
MENU_NAMES = {"국밥_돼지고기": "돼지국밥"}
LOOKUP_NAMES = {display: source for source, display in MENU_NAMES.items()}
CONDIMENTS = ("소스", "양념", "분말", "농축액", "육수", "베이스", "양념장")


def select_foods(items, term):
    query = normalized(term)
    choices = {}
    for row in items:
        code = str(row.get("FOOD_CD") or "")
        group = row.get("DB_GRP_CM") or code[:1]
        if row.get("DB_CLASS_NM") == "상용제품":
            continue
        if group not in ("D", "R", "N") and row.get("DB_CLASS_NM") != "품목대표":
            continue
        if str(row.get("MAKER_NM") or "").strip() not in ("", "-", "해당없음"):
            continue
        food = convert(row)
        if not food:
            continue
        raw = food["name"].strip()
        display = MENU_NAMES.get(raw, raw)
        name = normalized(display)
        if query not in name and query not in normalized(raw):
            continue
        if any(part in name and part not in query for part in CONDIMENTS):
            continue
        food["name"] = display
        rank = (row.get("DB_CLASS_NM") != "품목대표",
                sum(v is None for v in food["values"].values()), code)
        if name not in choices or rank < choices[name][0]:
            choices[name] = (rank, food)
    names = sorted(choices, key=lambda name: (name != query, not name.startswith(query), len(name), name))
    if query in choices:
        names = [query]
    return [choices[name][1] for name in names[:24]]


@lru_cache(maxsize=384)
def lookup(term, key, cache_period):
    source = LOOKUP_NAMES.get(term, term)
    params = dict(serviceKey=key, type="json", FOOD_NM_KR=source, numOfRows=100)
    if source == "국밥_돼지고기":
        params.update(FOOD_CAT1_NM="밥류", numOfRows=20)
    rows = []
    for page in range(1, 4):
        url = ENDPOINT + "?" + urlencode(dict(params, pageNo=page))
        with urlopen(url, timeout=8) as response:
            data = json.load(response)
        data = data.get("response", data)
        if str(data.get("header", {}).get("resultCode", "")) not in ("00", "0", "0000"):
            raise ValueError("API response")
        body = data["body"]
        items = body.get("items") or []
        if isinstance(items, dict):
            items = items.get("item") or []
        if isinstance(items, dict):
            items = [items]
        rows.extend(items)
        foods = select_foods(rows, term)
        if foods or len(items) < params["numOfRows"] or page * params["numOfRows"] >= int(body.get("totalCount") or len(rows)):
            break
    return foods


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
        try:
            term = normalized(term) if normalized(term) in LOOKUP_NAMES else term
            foods = lookup(term, key, int(time.time() // 3600))
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            return self.reply(502, {"error": "공공데이터 조회에 실패했어요. 인증키의 승인 상태와 연결을 확인해 주세요."})
        return self.reply(200, {"foods": foods})

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if status == 200:
            self.send_header("Cache-Control", "private, max-age=900")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
