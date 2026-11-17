# nospo-data — 노스포스포츠 경기 데이터 자동 수집

사이트 저장소 `nosposports/nosposports.github.io`의 **`HANDOFF.md`를 먼저 읽는다** ("데이터 수집" 절).

- `scripts/update.mjs`: 유튜브 공식 채널(LCK, TVING, 쿠팡플레이 스포츠, NBA) RSS(+YouTube Data API)를 읽어
  제목에서 대진·라운드·세트 번호만 뽑아 `matches.json`을 만든다. 원본 제목은 저장하지 않는다.
- `.github/workflows/update.yml`: 한 번 돌면 약 40분 동안 10분마다 갱신, 끝에 다음 실행을 스스로 예약(체인). Secret `YT_API_KEY` 사용.
- `status.json`: 약 1시간마다 갱신되는 상태(마지막 확인 시각, 리그별 마지막 경기 날짜, 채널별 오류). 이상 여부는 여기부터 본다.
- 로컬 테스트: `OFFLINE=1 node scripts/update.mjs` (네트워크 없이 기존 videos.json으로 matches.json 재계산).
- 사용자와는 한국어로 대화한다. 파서·수집 방식을 바꾸면 결과(`matches.json` 경기 수·리그별 날짜)를 보여주고 push한다.
