"""Package the project and a browser launcher for its deployed HTTPS address."""
from pathlib import Path
from html import escape
from urllib.parse import urlsplit
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent


def package(url):
    address = urlsplit(url)
    if (address.scheme != "https" or not address.hostname or address.username
            or address.password or address.query or address.fragment
            or any(c.isspace() for c in url)):
        raise ValueError("배포된 앱의 HTTPS 주소를 입력하세요.")
    link = escape(url, quote=True)
    page = (f'<!doctype html><html lang="ko"><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0;url={link}">'
            f'<title>한끼 열기</title><a href="{link}">한끼 식습관 분석 열기</a></html>')
    target = root / "한끼_제출용.zip"
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        archive.writestr("한끼 열기.html", page)
        for name in ("README.md", "make_submission.py", "render.yaml", "run.py", "food_api.py"):
            archive.write(root / name, name)
        for name in ("app.js", "styles.css", "nutrition.js", "index.html",
                     "run.py", "food_api.py"):
            archive.write(root / "hankki" / name, "hankki/" + name)
        for icon in sorted((root / "hankki/assets").glob("*.png")):
            archive.write(icon, "hankki/assets/" + icon.name)
    return target


if __name__ == "__main__":
    try:
        print(package(input("배포된 한끼 앱의 HTTPS 주소: ").strip()))
    except ValueError as error:
        raise SystemExit(str(error))
