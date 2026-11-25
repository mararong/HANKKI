"""Name lookup in the MFDS Food Nutrient Database."""
import gzip
import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

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


# MFDS frequently stores a compound dish as base_modifier.
DISH_BASES = sorted("""
볶음밥 비빔밥 덮밥 김밥 주먹밥 국밥 초밥 쌈밥 죽 밥
칼국수 막국수 냉국수 국수 냉면 라면 우동 짬뽕 짜장면 파스타 스파게티 수제비
된장찌개 김치찌개 찌개 전골 갈비탕 탕 미역국 해장국 된장국 국
떡볶이 불고기 갈비찜 볶음 조림 무침 구이 튀김 부침개 전 찜
샌드위치 햄버거 버거 피자 샐러드 만두 떡 빵 케이크 수프 스프
""".split(), key=len, reverse=True)
PLAIN = {"일반", "기본", "보통"}
CONDIMENTS = ("소스", "분말", "농축액", "육수", "베이스", "양념장")
# The database spells the ingredient out, while the common menu name is shorter.
SHORT_INGREDIENTS = {"돼지고기": "돼지", "소고기": "소", "쇠고기": "소"}
SEARCH_ALIASES = {"돼지국밥": "국밥_돼지고기"}


def menu_name(raw, query):
    parts = [part.strip() for part in raw.split("_")]
    if len(parts) != 2 or not all(parts):
        return raw
    base, modifier = parts
    if modifier in PLAIN:
        return base
    if modifier.endswith(base):
        return modifier
    if normalized(modifier + base) == query:
        return modifier + base
    if normalized(SHORT_INGREDIENTS.get(modifier, modifier) + base) == query:
        return SHORT_INGREDIENTS.get(modifier, modifier) + base
    if normalized(raw) == query:
        return raw
    if base in DISH_BASES and not any(c in modifier for c in "(),/"):
        return modifier + base
    return raw


def source_names(term):
    query = normalized(term)
    if query in SEARCH_ALIASES:
        yield SEARCH_ALIASES[query]
    for base in DISH_BASES:
        if query != base and query.endswith(base):
            yield base + "_" + query[:-len(base)]
            break
    yield term
    if query != term:
        yield query
    # An unfamiliar dish type can also use base_modifier notation.
    # A modifier prefix narrows the API lookup; selection checks the whole name.
    if len(query) >= 3:
        yield "_" + query[:2]


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
        display = menu_name(raw, query)
        name = normalized(display)
        if query not in name and query not in normalized(raw):
            continue
        if name != query and any(part in name and part not in query for part in CONDIMENTS):
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
def fetch_page(source, page, key, cache_period):
    params = dict(serviceKey=key, type="json", FOOD_NM_KR=source, numOfRows=100)
    url = ENDPOINT + "?" + urlencode(dict(params, pageNo=page))
    request = Request(url, headers={"Accept-Encoding": "gzip"})
    with urlopen(request, timeout=8) as response:
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            data = json.loads(gzip.decompress(response.read()))
        else:
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
    keep = ("FOOD_CD", "FOOD_NM_KR", "SERVING_SIZE", "MAKER_NM", "DB_GRP_CM", "DB_CLASS_NM",
            *("AMT_NUM" + str(n) for n in FIELDS.values()))
    return [{k: row[k] for k in keep if k in row} for row in items], int(body.get("totalCount") or 0)


# Share a bounded pool across requests so simultaneous typing cannot multiply
# the number of connections opened to the upstream service.
SEARCH_POOL = ThreadPoolExecutor(max_workers=8)


def search_source(source, term, key, cache_period):
    query = normalized(term)
    rows = []
    for page in range(1, 4):
        items, total = fetch_page(source, page, key, cache_period)
        rows.extend(items)
        matches = select_foods(rows, term)
        if matches and normalized(matches[0]["name"]) == query:
            return rows, matches
        if len(items) < 100 or (total and page * 100 >= total):
            break
    return rows, []


@lru_cache(maxsize=384)
def lookup(term, key, cache_period):
    sources = list(dict.fromkeys(source_names(term)))
    # Reserve the broad ingredient-prefix lookup for a genuine miss.
    fallback = sources.pop() if len(sources) > 1 and sources[-1].startswith("_") else None
    pending = [SEARCH_POOL.submit(search_source, source, term, key, cache_period)
               for source in sources]
    rows = []
    error = None
    try:
        for future in as_completed(pending):
            try:
                batch, exact = future.result()
            except (OSError, ValueError, KeyError, AttributeError, TypeError) as exc:
                error = exc
                continue
            if exact:
                return exact
            rows.extend(batch)
    finally:
        for future in pending:
            future.cancel()
    matches = select_foods(rows, term)
    if fallback and (not matches or normalized(term) not in DISH_BASES):
        more, exact = search_source(fallback, term, key, cache_period)
        if exact:
            return exact
        matches = select_foods(rows + more, term)
    if error:
        raise error
    return matches


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
