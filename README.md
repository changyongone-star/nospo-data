# nospo-data

노스포 스포츠(토스 미니앱)가 읽는 하이라이트 목록입니다.

- `matches.json` : 앱이 읽는 경기 목록 (날짜·대진·세트별 유튜브 영상 ID만, 점수·제목 없음)
- `videos.json` : 수집 중간 데이터 (30일 지나면 자동 삭제)
- `scripts/update.mjs` : LCK 공식 유튜브 채널의 공개 RSS를 읽어 목록을 갱신
- `.github/workflows/update.yml` : 30분마다 자동 실행 (Actions 탭에서 수동 실행도 가능)
