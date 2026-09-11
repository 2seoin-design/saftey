# 세이프티(안전디딤돌) 기능 정리

현재 저장소에 구현되어 있는 전체 기능을 페이지/백엔드/DB 기준으로 정리한 문서입니다.
(정책 기획 문서는 `SAFTEY_PRD.md` 참고 — 이 문서는 실제 코드에 구현된 현황 기준입니다.)

기술 스택: 프론트엔드는 정적 HTML + Tailwind(CDN) + 바닐라 JS(ES Module), 백엔드는 Vercel 서버리스 함수(`api/`)와 Supabase(Postgres + PostGIS + Auth + Realtime + Storage), 지도/경로는 TMAP API, 이미지 분석은 Google Gemini API를 사용합니다.

---

## 1. 사용자 인증

| 페이지 | 기능 |
|---|---|
| `frontend/login.html` | 이메일/비밀번호 로그인 |
| `frontend/newmembership.html` | 회원가입 (이름/이메일/비밀번호), 제출 전 이메일 중복 확인 |
| `frontend/logout.html` | 로그아웃 확인 화면 |

- 가입 시 `handle_new_user` 트리거가 `profiles` 테이블에 이름/프로필사진을 자동 동기화
- 이메일 중복 확인은 `email_exists` RPC로 처리 (auth.users를 직접 조회할 수 없어 SECURITY DEFINER 함수로 우회)
- 로그인 세션은 브라우저 `localStorage`에 저장되며, 페이지 진입 시 세션 토큰 존재 여부로 비로그인 접근을 막음
- 세션 만료(기본 1시간) 대비 `getFreshSession()` 헬퍼가 만료 임박 시 자동 갱신

---

## 2. 홈 / 메인 대시보드

**`frontend/mainhome.html`** — 로그인 후 첫 화면. 안심 산책로 길안내, 10초 사진 제보, 커뮤니티, 포인트 사용처 등 주요 기능으로 이동하는 허브.

---

## 3. 안전지도 & 실시간 제보

**`frontend/safymap.html`** (하단 내비게이션 "안전지도")

- TMAP 기반 실시간 지도, 현재 위치 추적 및 역지오코딩으로 주소 표시
- 출발지/도착지 검색(TMAP POI 검색)
- 주변 실시간 위험 제보를 지도 마커로 표시 (`get_nearby_reports` RPC + Supabase Realtime 구독으로 신규 제보 자동 갱신)
- "안심 귀갓길" / "안전 산책로" 진입 버튼

**`frontend/route_map.html`** — 안심 귀갓길 경로 탐색 프로토타입 페이지. 출발/도착지 선택 후 일반 경로와 안심 경로(CCTV·비상벨 경유)를 비교 표시하고, 지도 클릭으로 위험 제보 등록 가능.

### 안심 경로 계산 로직 (`backend/data/routeService.js`, `backend/services/routeService.js`)

- TMAP 보행자 경로 API 호출
- 경로 주변 안전시설(CCTV/비상벨/보안등)과 위험 제보를 조회해 "안심 점수" 산출 (CCTV +3, 비상벨 +5, 보안등 +1, 위험 제보 -5)
- 공사/장애물 제보가 있으면 해당 구간을 회피 대상으로 표시
- 우선순위 높은 안전시설을 경유지로 삼아 TMAP에 재요청 → 안심 경로 생성

### 공공데이터 연동

- `api/facilities.js` — 행정안전부 등 공공데이터포털의 CCTV/비상벨 표준데이터를 실시간으로 받아 중계 (10분 캐시)
- `backend/scripts/dataIngestion.js` — 공공데이터를 `safety_facilities` 테이블에 적재하는 배치 스크립트
- `backend/data/liveFacilityService.js` — 반경 내 안전시설 실시간 조회

---

## 4. 안심 산책로 (도형 완주 리워드)

**`frontend/walking_line.html`**

- 하트·별·마름모·왕관·기하학적 물고기 5종 도형 코스 중 선택
- 현재 위치를 중심으로 실제 도로망을 따라가는 도형 모양 산책 경로를 생성 (`generateShapeRoute`, `backend/data/shapeRouteService.js`)
  - 도형별 목표 거리/소요시간/탐색반경이 사전 정의됨 (예: 마름모 0.67km/10분, 왕관 6km/90분)
  - 경로 주변에 안전시설이 있으면 그쪽으로 살짝 스냅해 CCTV/비상벨 인근을 지나가도록 유도
- "안내 시작" 시 GPS 위치를 지속 추적(`watchPosition`)하며 궤적 기록
- "안내 종료" 시 목표 경로와 실제 GPS 궤적의 유사도를 분석 (`analyzeGpsSimilarity`, `backend/data/patternMatchService.js`)
  - Discrete Fréchet distance + Hausdorff distance 기반 유사도(%) 계산
  - 일치도 85% 이상이면 완주로 인정
- 완주 시 리워드 지급 및 완주 내역 기록은 `complete_course_walk` DB 함수가 담당 (아래 5번 참고)

**`frontend/walk_list.html`** (마이페이지 하위) — 내 완주 내역: 총 완주 횟수, 누적 거리(코스별 목표거리 합산), 획득 리워드, 완주 카드 목록(도형 아이콘/일시/거리/리워드 여부)을 `/api/mypage/completions`로 조회.

---

## 5. 리워드/포인트 시스템

- 유저의 총 포인트는 `profiles.points`에 누적 (사용 내역은 별도 저장하지 않음)
- **산책로 완주 리워드**: `claim_walk_reward()` RPC — 하루 1회, 최초 완주 시 200P. `walk_challenge_claims(user_id, claim_date)` 유니크 제약으로 동시 요청에도 중복 지급 방지
- **모양 완주 기록**: `complete_course_walk(p_course_name)` RPC — `claim_walk_reward()` 호출 결과를 그대로 받아 `course_completions`에 완주 이력(코스명/완주일시/리워드지급여부) 저장. 두 단계가 한 트랜잭션 안에서 실행되어 원자성 보장
- **제보 리워드**: `claim_report_reward()` RPC — 하루 1회, 제보 완료 시 500P (`report_reward_claims` 테이블)
- 모든 리워드 RPC는 클라이언트가 넘긴 값이 아니라 `auth.uid()`로 호출자 본인을 직접 확인 (다른 계정에 리워드를 조작해서 지급시키는 것을 DB 레벨에서 차단)
- **포인트 사용처**: `frontend/point_change.html` — 종로사랑상품권, 따릉이, 공공안심약국, 동네 편의점 등 포인트 사용 가능 제휴처 안내 (실제 결제/차감 기능은 없음, 안내 페이지)

---

## 6. 10초 간편제보 (AI 이미지 분석 포함)

**`frontend/10report.html`** + **`backend/10report.js`**

- 카메라 촬영 또는 앨범에서 사진 선택 → 현재 위치 자동 첨부 → 원터치 제보 등록
- 사진 선택 즉시 AI가 위험 유형을 자동 분류 (`api/analyze-image.js` 또는 동등한 Supabase Edge Function `supabase/functions/analyze-image`)
  - Gemini API로 사진을 분석해 5개 카테고리(보도·포트홀 파손 / 가로등·조도 불량 / 계단·단차 턱 / 불법 적치물·통행방해 / 기타 위험) 중 하나로 자동 분류하고 UI에 반영
  - 싱크홀/포트홀처럼 지면이 꺼진 경우 우선적으로 "보도·포트홀 파손"으로 분류하도록 프롬프트에 명시
  - GEMINI_API_KEY가 클라이언트에 있으면 Gemini를 직접 호출, 없으면 서버(`/api/analyze-image`)를 통해 분석 (API 키를 브라우저에 노출하지 않는 경로)
- 제보 상태 필터(접수/조치중/완료 등) 및 상태 변경 UI
- 사진은 Supabase Storage(`report-images` 버킷)에 업로드되고 공개 URL이 제보 레코드에 저장됨

---

## 7. 마이페이지

**`frontend/mypage.html`**

- 프로필(이름/사진), 총 제보 건수, 보유 리워드 포인트 표시
- 메뉴: 내 제보 내역 및 실시간 조치 현황(`request_list.html`), 안심 산책로 성공내역(`walk_list.html`) — 각 메뉴 미리보기 문구도 실데이터 기준(미처리/처리완료 건수, 완주 횟수/거리)으로 표시
- 포인트 사용 가능처 배너, 로그아웃

**`frontend/mypage_change.html`** — 이름/프로필 사진 수정

**`frontend/request_list.html`** — 내 제보 목록: 총 제보/미처리/처리완료 건수 요약, 상태별 필터, 제보별 카드(일시/처리상태/제보유형/설명/사진)를 `/api/mypage/reports`로 조회

---

## 8. 커뮤니티

**`frontend/community.html`** — 게시글 목록 (페이지당 10개, 최신순), 작성자 이름/프로필 사진 표시

**`frontend/add_comm.html`** — 글쓰기/수정 (제목/내용/사진 1장), 이미지는 `community-images` Storage 버킷에 업로드

- `backend/data/communityService.js`가 CRUD 담당 (작성/조회/수정/삭제)
- 수정/삭제는 RLS(`author_id = auth.uid()`)로 작성자 본인만 가능하도록 DB 레벨에서 강제

---

## 9. 백엔드 API (Vercel 서버리스, `api/`)

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/facilities` | GET | 공공데이터(CCTV/비상벨) 프록시, 10분 캐시 |
| `/api/analyze-image` | POST | 사진 → Gemini AI 위험 유형 분석 |
| `/api/mypage/points` | GET | 내 총 포인트 조회 |
| `/api/mypage/reports` | GET | 내 제보 내역 조회 (최신순) |
| `/api/mypage/completions` | GET | 내 산책로 완주 내역 조회 (최신순) |
| `/api/walk/complete` | POST | 산책로 완주 처리 (리워드 지급 + 완주 기록) |

`/api/mypage/*`, `/api/walk/*`는 `Authorization: Bearer <supabase access_token>` 필요. 서버는 service role 키 없이, 요청자 JWT를 그대로 Supabase에 실어 보내 RLS가 본인 데이터만 노출하도록 함 (`backend/services/authHelper.js`).

---

## 10. DB 스키마 요약 (Supabase Postgres)

| 테이블 | 용도 |
|---|---|
| `profiles` | 유저 프로필(이름/사진) + 총 포인트(`points`) |
| `safety_facilities` | CCTV/비상벨/보안등 공공데이터 (PostGIS) |
| `reports` | 실시간 위험 제보 (위치/유형/설명/사진/처리상태), 3시간 TTL로 지도에서 자동 소멸 |
| `walk_challenge_claims` | 산책로 리워드 하루 1회 지급 여부 기록 |
| `course_completions` | 도형 산책로 완주 이력(코스명/일시/리워드여부) |
| `report_reward_claims` | 제보 리워드 하루 1회 지급 여부 기록 |
| `community_posts` | 커뮤니티 게시글 |

주요 RPC(함수): `get_nearby_safety_facilities`, `get_nearby_reports`, `email_exists`, `claim_walk_reward`, `complete_course_walk`, `claim_report_reward`, `delete_expired_reports`(제보 TTL 정리, pg_cron으로 5분마다 실행)

Storage 버킷: `report-images`(제보 사진), `community-images`(커뮤니티 사진, 공개 읽기 + 소유자만 업로드/삭제)
