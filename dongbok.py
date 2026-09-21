import json
import re
from datetime import datetime, timezone, timedelta
import requests
from bs4 import BeautifulSoup

URL = "https://water.jeonnam-gwangju.go.kr/mainPortal.do"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36"
    )
}


def fetch_dongbok_data():
    response = requests.get(URL, headers=HEADERS, timeout=15)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # 1. '동복수원지' 텍스트를 가진 요소 찾기
    dongbok_link = soup.find("a", string=re.compile("동복수원지"))
    if not dongbok_link:
        raise ValueError("'동복수원지' 링크 요소를 찾을 수 없습니다.")

    # 2. 부모 li 태그 (<li class="m01">)로 이동
    parent_li = dongbok_link.find_parent("li")
    if not parent_li:
        raise ValueError("동복수원지 li 컨테이너를 찾을 수 없습니다.")

    # 3. cont_body 내부의 항목들 파싱
    parsed_result = {
        "reservoir": "동복수원지",
        "storage_rate": None,  # 저수율 (%)
        "storage_amount": None,  # 저수량
        "intake_amount": None,  # 취수량
    "updated_at": (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M:%S"),  # UTC 시간을 KST로 변환
    }

    items = parent_li.select(".cont_body ul li")
    for item in items:
        p_tags = item.find_all("p")
        if len(p_tags) >= 2:
            label = p_tags[0].get_text(strip=True)
            value = p_tags[1].get_text(strip=True)

            if "저수율" in label:
                # '56.38%' -> 56.38 (float)
                match = re.search(r"(\d+(?:\.\d+)?)", value)
                if match:
                    parsed_result["storage_rate"] = float(match.group(1))
            elif "저수량" in label:
                # 공백 정리
                parsed_result["storage_amount"] = value
            elif "취수량" in label:
                parsed_result["intake_amount"] = value

    if parsed_result["storage_rate"] is None:
        raise ValueError("동복수원지 저수율 수치 추출에 실패했습니다.")

    return parsed_result


def main():
    try:
        data = fetch_dongbok_data()

        # data.json 파일로 저장
        with open("data.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"성공: 저수율 {data['storage_rate']}% 저장 완료")
        print(f"데이터: {data}")
    except Exception as e:
        print(f"오류 발생: {e}")
        exit(1)


if __name__ == "__main__":
    main()