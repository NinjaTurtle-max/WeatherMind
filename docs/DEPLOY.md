# 실서버 배포 절차 — 서버가 생긴 순간부터 URL이 열릴 때까지

**작성 2026-08-06.** 클라우드 제공자와 무관하다(Oracle·GCP·Hetzner 모두 동일) —
필요한 것은 **Ubuntu 22.04 · 4GB↑ RAM · 공인 IP · 도메인** 넷뿐이다.
제출물 ④(구동·배포 문서)의 초안이기도 하다 — 대회 이후 공공 교육용 재현이
요건이므로 여기 적힌 것만으로 처음부터 띄울 수 있어야 한다.

> 소요: **30~40분**(이미지 pull 대기 포함). 막히면 §6 트러블슈팅.

---

## 0. 사전 준비 (서버 만들기 전에)

| 항목 | 값 | 비고 |
|---|---|---|
| OS | Ubuntu 22.04 LTS | 24.04도 가능 |
| RAM | **6GB↑ 권장(4GB는 여유 없음)** | mem_limit 합 **4096m = 4.0GB**(2026-08-09 실측) |
| 디스크 | 40GB↑ | 이미지 1.9GB + 데이터 |
| 공인 IP | 필수 | 없으면 외부 접속 불가 |
| 열 포트 | **22 · 80 · 443** | 클라우드 방화벽 + OS 방화벽 **양쪽** |
| 도메인 | 필수 | Caddy auto-HTTPS 전제(IP로는 인증서 발급 불가) |

> 합계 4096m의 근거는 `docker-compose.prod.yml`의 `mem_limit` 9개다. **손으로
> 추정하지 말고 세라** — 이 표에 4.12GB가 굳어 있던 것이 2026-08-09에 발견됐다:
> ```bash
> grep -o 'mem_limit: [0-9]*m' docker-compose.prod.yml | grep -o '[0-9]*' | paste -sd+ - | bc
> ```

### 🔴 클라우드 방화벽 — **태그와 규칙은 별개다** (2026-08-13 실측, 30분 소모)

GCP에서 인증서 발급이 **4번 연속 실패**했고 원인이 여기였다. VM에
`http-server`·`https-server` **태그는 붙어 있었는데, 그 태그를 여는 방화벽 규칙
자체가 없었다**(프로젝트에 `default-allow-icmp`·`internal`·`rdp`·`ssh` 넷뿐).

⚠️ **태그를 붙였다고 포트가 열리지 않는다.** 태그는 「이 규칙을 어느 VM에
적용할지」의 **라벨**일 뿐이고, 규칙이 없으면 라벨은 아무것도 가리키지 않는다.
콘솔의 VM 상세에 「HTTP 트래픽 허용 ✅」이 체크돼 보여도 그렇다.

**증상으로 알아보는 법**: Let's Encrypt HTTP-01 챌린지가 타임아웃으로 실패한다.
컨테이너는 정상이고 서버 안에서 `curl localhost`는 되는데 **밖에서만 안 닿는다**.
OS 방화벽(§3)을 아무리 봐도 안 나온다 — 그건 다른 층이다.

```bash
# ① 규칙이 실제로 있는지 확인 — 태그가 아니라 규칙을 본다
gcloud compute firewall-rules list --format='table(name,allowed[],targetTags.list())'

# ② 없으면 만든다 (태그를 이미 붙여 뒀어도 이 두 줄이 필요하다)
gcloud compute firewall-rules create allow-http  --allow=tcp:80  --target-tags=http-server
gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server
```

**아키텍처**: GHCR 이미지는 `linux/amd64`·`linux/arm64` 둘 다 발행된다
(`release.yml`). x86 VM(GCP·AWS)도 ARM VM(Oracle A1)도 그대로 돌아간다.

⚠️ **2026-08-13부터 GHCR을 쓰지 않는다**(대회 종료까지). GitHub Actions가 무료 분
소진으로 멈췄고 클라이언트가 과금하지 않기로 정했다 — **이미지는 서버에서 직접
빌드한다**(롤링마다 10~20분). 함정 하나: `docker-compose.prod.yml`에는 `build:`가
**없다**(`image:`만) — 그대로 `compose build`하면 **아무것도 만들지 않는다.** dev
정의(`docker-compose.yml`)로 빌드 → prod가 찾는 이름으로 `docker tag` → prod 기동.
9/1에 무료 분이 초기화되면 원복된다. 경위는 대장 §4.11.

**재기동 정책**: prod 전 컨테이너가 `restart: unless-stopped`다 — **호스트 재부팅
후에도 스택이 자동 복구된다**(URL을 9월 셋째 주까지 유지해야 하므로 이게 계약이다).
운영자가 `docker compose stop`으로 명시적으로 내린 것만 그대로 남는다.

### 🔴 외부 IP가 **ephemeral이면 VM stop/start에서 제출 URL이 죽는다**

바로 위 「재기동 정책」은 **컨테이너** 이야기다. 그 위층에 하나가 더 있다:
**VM의 외부 IP가 ephemeral이면 VM을 stop 했다가 start 할 때 IP가 새로 배정된다.**

⚠️ **제출 URL이 `34-47-71-146.sslip.io`이므로 이건 "IP가 바뀐다"로 끝나지 않는다.**
sslip.io는 **호스트명이 곧 IP**다 — `34-47-71-146.sslip.io`는 DNS가
`34.47.71.146`을 되돌려 주도록 이름 자체에 주소가 박혀 있다. 그래서 IP가 바뀌면
A레코드를 고쳐 살릴 수 있는 종류의 사고가 아니라 **URL 문자열 자체가 죽는다.**
구글 폼으로 제출한 구동 URL이 그대로 무효가 되고, 새 IP로 URL이 바뀌면
**제출물을 고칠 수 없는 시점(8/21 18:00 동결)에는 복구 수단이 없다.**

🟢 **재부팅(`sudo reboot`)은 무해하다** — VM 인스턴스가 RUNNING을 유지하므로
ephemeral IP도 그대로 붙어 있고, 컨테이너는 `unless-stopped`로 자동 복구된다.
🔴 **위험한 것은 stop/start다** — 콘솔의 「중지」, `gcloud compute instances stop`,
비용 절감용 자동 일시중지, 유지보수 정책에 따른 종료·재생성이 전부 여기 해당한다.
**둘을 같은 것으로 취급하지 말 것.**

```bash
# 지금 어느 쪽인지 확인 — EPHEMERAL이면 아직 안전하지 않다
gcloud compute addresses list
```

`EPHEMERAL`로 나오면 **static으로 승격**해야 URL이 stop/start를 견딘다.
승격 전까지는 **VM을 stop 하지 않는 것**이 유일한 방어다(재부팅으로 충분한
일이면 재부팅을 쓴다). 승격 후에는 예약 주소가 되어 stop/start에도 유지된다.

---

## 1. 서버 접속

```bash
chmod 600 ~/.ssh/<키파일>              # 권한이 느슨하면 ssh가 거부한다
ssh -i ~/.ssh/<키파일> ubuntu@<공인IP>   # Oracle/GCP Ubuntu 이미지의 기본 계정은 ubuntu
```

## 2. Docker 설치

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker   # sudo 없이 docker 쓰기
docker compose version                            # v2.24+ 확인(!reset 문법 전제)
```

> ⚠️ **compose v2.24 미만이면 `!reset`이 파싱되지 않아 prod 오버레이가 깨진다.**
> 위 공식 저장소 방식은 최신을 설치하므로 문제없지만, `apt install docker.io`
> 같은 배포판 패키지로 깔면 구버전이 들어올 수 있다.

## 3. OS 방화벽 (클라우드 방화벽과 **별개**)

Oracle Ubuntu 이미지는 iptables가 기본으로 막혀 있어 **클라우드 콘솔에서 포트를
열어도 접속이 안 된다.** 이 단계를 빠뜨리는 것이 가장 흔한 실패다.

```bash
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save    # 재부팅 후에도 유지 (없으면: sudo apt install -y iptables-persistent)
```

GCP는 OS 방화벽이 열려 있으므로 **콘솔의 VPC 방화벽 규칙만** 만들면 된다
(`tcp:80,443`, 대상 `0.0.0.0/0`).

## 4. 소스와 이미지 가져오기

```bash
git clone https://github.com/NinjaTurtle-max/WeatherMind.git
cd WeatherMind
```

저장소가 **private이므로 GHCR 이미지도 private**이다. 이미지 pull 전에 로그인한다:

```bash
# GitHub → Settings → Developer settings → Personal access tokens (classic)
#   → 스코프 read:packages 만 체크해 발급
echo "<PAT>" | docker login ghcr.io -u <GitHub사용자명> --password-stdin
```

## 5. 환경변수와 기동

```bash
cp .env.example .env
nano .env
```

반드시 채울 것:

| 키 | 설명 |
|---|---|
| `DOMAIN` | **실도메인.** 이게 있어야 Caddy가 Let's Encrypt 인증서를 받는다 |
| `POSTGRES_PASSWORD` | 강한 임의값 |
| `JWT_SECRET_KEY` | 강한 임의값 (`openssl rand -hex 32`) |
| `AI_WORKER_INTERNAL_API_KEY` | 강한 임의값 |
| `DATABASE_URL` | **런타임 = 앱 롤 `weathermind_app`.** ⚠️ **비밀번호를 반드시 바꿔야 한다** — `.env.example`의 `weathermind_app_dev`는 공개 저장소에 평문으로 있어 **placeholder로 취급되고, 그대로 두면 backend가 기동을 거부한다**(CO-Q-11). 아래 §5.1 참조 |
| `MIGRATION_DATABASE_URL` | 소유자 롤 — alembic 전용. RLS 전제(`docs/specs/08`) |
| `CELERY_DATABASE_URL` | 배치 롤. **미설정 시 `MIGRATION_DATABASE_URL`로 자동 폴백**하므로 보통 비워 둔다(CO-Q-1) |
| `KMA_API_KEY` | **기상청 API허브**(apihub.kma.go.kr) 마이페이지 인증키 — 공공데이터포털 serviceKey가 **아니다**(R13 전환, `docs/specs/06`). ⚠️ 대회 제공 계정 키는 8/22 만료인데 규정상 URL은 9월 셋째 주까지 살아 있어야 하므로 **스페어를 함께 넣는다**(아래 행). API허브는 **API마다 활용신청**이 따로다 — `getVilageFcst`·`getMidLandFcst`·`getDailyWthrData` 3종 승인 필요. 동작 확인은 `GET /health`의 `kma.state`(아래 §5.2) |
| `KMA_API_KEY_SPARE` | **스페어(2번) 호출키 = 개인 계정 키.** 주키 실패·한도 소진(20,000콜/일) 시 자동 폴백한다(`weather_api.auth_keys`). 대회 계정 주키가 8/22에 만료돼도 URL이 9월까지 살아야 하므로 **비워 두지 말 것**. ⚠️ 스페어 계정에도 **같은 3종 활용신청**이 승인돼 있어야 한다 — 키만 넣으면 만료 당일 둘 다 조용히 실패한다 |
| `GEMINI_API_KEY` | 키 게이트에서 투입. **없어도 폴백으로 전 기능 동작**. 임베딩 키는 없다(R13 3일차 철거) |
| `IMAGE_TAG` | 🔴 **배포할 커밋 sha를 반드시 지정한다**(미설정 시 `latest`). `latest`는 **이동 태그**라 어느 커밋을 가리키는지 절차 안에서 알 수 없다 — 그 위험이 실측으로 확인됐다: §6 ①-a 참조 |

### 5.1 앱 롤 비밀번호 교체 — **DB와 `.env`를 함께 바꾼다**

⚠️ **한쪽만 바꾸면 양쪽 다 죽는다.** `.env`만 바꾸면 postgres 인증 실패, DB만 바꾸면
`.env`의 dev 비번이 placeholder로 걸려 backend 기동 거부다.

```bash
NEWPW=$(openssl rand -hex 24)

# ① .env의 DATABASE_URL 비번 교체
sed -i.bak "s|weathermind_app:weathermind_app_dev@|weathermind_app:${NEWPW}@|" .env

# ② DB 롤 비번 교체 (컨테이너가 이미 떠 있어야 한다 — 아래 up -d 뒤에 실행)
$C exec -T postgres psql -U weathermind -d weathermind \
  -c "ALTER ROLE weathermind_app PASSWORD '${NEWPW}';"

# ③ backend 재기동 (①을 읽게)
$C up -d --force-recreate backend celery-worker celery-beat
```

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C pull

# ⚠️ 첫 기동은 **인프라 + backend만** 올린다. 통째로 up 하면 실패한다 — 이유는 아래.
$C up -d postgres redis backend db-backup celery-worker celery-beat ai-worker
```

⚠️ **첫 기동 직후 backend는 정상적으로 "실패(unhealthy)" 상태다.** §5.1 ①에서
`.env`의 앱 롤 비번을 바꿨는데 DB 롤의 비번은 아직 `init.sql`의 dev 기본값이라
접속이 안 된다(`/health`가 DB SELECT 1을 보므로 503). 테이블·정책도 아직 없다.
§6 → §5.1 ②③을 끝내면 healthy가 된다.

⚠️ **그래서 `$C up -d`(전체)를 먼저 치면 안 된다.** `frontend`와 `caddy`는
`depends_on: backend / condition: service_healthy`로 물려 있어(CO-J-16 — 죽은
backend를 Caddy가 프론트해 첫 방문자가 502를 보는 것을 막는 장치다) backend가
초록이 되기 전에는 생성되지 않고, `up`이 *"dependency failed to start"*로 종료한다.
**초기화가 끝난 뒤 §6 ⑤에서 전체 `up -d`를 한 번 더 치면 그때 함께 올라온다.**

### 5.2 KMA 키 게이트 — **"넣었다"와 "동작한다"는 다르다**

기상청 키가 틀렸거나 활용신청이 안 됐거나 만료됐어도 **서비스는 200으로 멀쩡히
뜬다**(KMA는 하드 의존이 아니라 날씨 칸만 비운다). 종전에는 이걸 알려 주는 것이
하나도 없어서 잘못된 키로 며칠을 갈 수 있었다. 지금은 `/health`가 보고한다.

```bash
# ⚠️ 호스트에서 `curl localhost:8000`은 **prod에서 안 된다.**
# docker-compose.prod.yml이 backend의 ports를 `!reset []`로 지워 8000은
# 호스트에 열려 있지 않다(하드닝 — 외부에 열린 것은 Caddy뿐). 컨테이너 안에서 친다.
$C exec -T backend curl -s http://localhost:8000/health | python3 -m json.tool
```

`kma` 필드만 보면 된다.

| `state` | 뜻 | 조치 |
|---|---|---|
| `ok` | 인증 성공 | 없음 |
| `degraded` | 설정된 키가 **전부** 실패 | 키 오타 · 활용신청 미승인 · 만료 확인 |
| `unconfigured` | 키가 하나도 없음 | `.env`에 넣고 **재생성**(아래) |
| `unknown` | 아직 한 번도 호출 안 됨 | 기동 직후 잠깐 |

🔴 **`active_key`가 `spare`면 주키가 죽은 것이다.** 서비스는 스페어로 계속 돌지만
남은 키가 하나뿐이라는 뜻이므로 주키를 복구할 것. 8/22(대회 계정 만료) 전후로 이
값이 바뀌는지 봐야 한다. `spare_configured: false`면 스페어가 아예 안 들어간 것이다.

⚠️ **`.env`를 고친 뒤에는 `docker compose restart`가 아니라 `up -d`다.** `env_file`은
컨테이너 **생성 시점**에 주입되므로 restart로는 새 키가 안 들어간다.

⚠️ **`state: ok`는 단기예보 기준이다.** 프로브는 단기예보 1콜만 친다. 일자료는
계열이 달라(typ01) 별도 확인이 필요하다 — 아래.

### 5.3 일자료(ASOS) 활용신청 — **월보를 신청하면 안 된다**

리그·대결 정산이 쓰는 일자료는 **「지상관측 > 종관기상관측(ASOS) > 1.3 일자료」**
(`typ01/url/kma_sfcdd.php`)다. openApi 쪽 **「4.5 해당월의일별기상자료조회」**
(`getDailyWthrData`)는 **월보라 당월을 주지 않는다** — 어제 날짜로 부르면
`resultCode=99 "발간되지 않은 기간입니다"`다(2026-08-10 실측). 그걸 승인해 두면
정산이 이달 내내 빈손으로 돈다. 코드는 typ01을 쓰도록 교체돼 있다.

확인(값 노출 없이 결과만):

```bash
curl -s "https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php?tm=$(date -v-1d +%Y%m%d)&stn=108&help=0&authKey=$KMA_API_KEY" \
  | grep -v '^#' | head -1 | cut -d, -f1,11,12,14,39
```

`20260809,27.6,31.6,24.5,-9.0` 처럼 **날짜·평균·최고·최저·강수**가 나오면 정상이다.
`-9`는 결측 표기이고 코드가 0.0으로 흡수한다. 아무것도 안 나오면 1.3 활용신청이
안 된 것이다(미승인은 **HTTP 403**).

## 6. 초기화 (최초 1회)

⚠️ **순서가 계약이다.** 어기면 조용히 깨진다 — 아래 각 단계에 이유를 적었다.

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# ①-a 🔴 이미지가 최신 마이그레이션을 담고 있는지 **먼저** 확인한다 (CO-J-15)
#     빈 볼륨 리허설(2026-08-09)에서 잡힌 것: 낡은 이미지로 upgrade하면 도중까지만
#     적용되는데 **에러가 0건**이고, `alembic current`도 `heads`도 **이미지 안의**
#     versions/를 읽으므로 `current == heads`가 되어 아래 검증을 통과한다.
#     즉 마이그레이션이 빠진 채 "정상"으로 신고된다. 그때 CO-R-4의 UNIQUE 제약 같은
#     것이 영영 안 걸리고, 절차 안에 그것을 알아낼 방법이 없다.
IMG=$($C exec -T backend sh -c 'ls alembic/versions/*.py | wc -l')
REPO=$(ls backend/alembic/versions/*.py | wc -l)
echo "이미지 $IMG개 / 저장소 $REPO개"   # ← 다르면 멈추고 IMAGE_TAG를 다시 잡는다

# ① 마이그레이션 — 소유자 롤(MIGRATION_DATABASE_URL)로 돈다
$C exec backend alembic upgrade head

# ② RLS 예외 정책 — **신규 볼륨에도 필수다** (CO-Q-12)
#    init.sql은 롤·GRANT만 만든다. 그 시점엔 테이블이 없어 정책을 만들 수 없다.
#    이걸 건너뛰면 users에 user_isolation만 걸려 **로그인·게스트 시작이 전면 0행**이고,
#    리더보드도 빈다. "기존 볼륨에만"이 아니다.
#    `-v ON_ERROR_STOP=1`을 빠뜨리지 말 것 — 없으면 중간 구문이 실패해도 psql이
#    끝까지 스크롤하고 종료코드 0을 내서, 운영자는 정책이 안 걸린 채 다음 단계로 간다.
$C exec -T postgres psql -U weathermind -d weathermind -v ON_ERROR_STOP=1 \
  < backend/app/scripts/rls_app_role.sql

# ③ 시드 — **courses가 units보다 먼저** (CO-J-7)
#    seed_units가 course 슬러그를 못 찾으면 course_id를 NULL로 두고 넘어간다.
#    그러면 전 유닛이 단일 코스로 뭉치고 GET /courses가 비어 학습 화면이 백지가 된다.
#    scripts/smoke.sh가 이 순서를 계약으로 검사한다.
$C exec backend python -m app.scripts.seed_courses    # ← 빠뜨리기 쉽다
$C exec backend python -m app.scripts.seed_content    # 문항 1,012 (2026-08-12 실측 — 08-09의 284는 낡았다)
$C exec backend python -m app.scripts.seed_units      # 유닛 24 (courses 필요)
$C exec backend python -m app.scripts.seed_badges     # 배지

# ④ 앱 롤 비번 교체 + 재기동 — §5.1 ②③

# ⑤ 전체 기동 — 여기서 처음으로 frontend·caddy가 올라온다
#    (backend가 healthy가 되기 전에는 두 서비스가 생성되지 않는다 — §5 마지막 경고)
$C up -d
$C ps    # 전 컨테이너 Up, backend는 (healthy)
```

**검증**: `$C exec backend python -c "from app.core.config import insecure_secret_defaults as f; print(f() or 'OK')"`
→ `OK`가 아니면 그 키가 placeholder다. 기동 거부의 원인이 그대로 출력된다.

## 7. 확인

```bash
$C ps                          # 전 컨테이너 Up
$C logs -f caddy               # 인증서 발급 로그(실패 시 §8)
curl -I https://<도메인>/        # 200 — 외부에서 확인하는 것은 여기까지다

# backend 헬스는 **컨테이너 안에서** 본다. 외부 URL로 치지 말 것 — 이유는 바로 아래.
$C exec -T backend curl -s http://localhost:8000/health | python3 -m json.tool

docker stats --no-stream       # 메모리가 mem_limit 안에 있는지
```

### 🔴 `/health`를 외부 URL로 치지 말 것 — **2026-08-18 롤링부터 거짓말을 한다**

`infra/Caddyfile`의 `handle /health` 블록은 **2026-08-18 롤링에서 제거된다**
(헬스 엔드포인트를 외부에 노출하지 않기 위해). 그 뒤 `https://<도메인>/health`는
**404가 되지 않는다** — Caddy의 남은 `handle`이 그 경로를 frontend nginx로 보내고
nginx의 **SPA 폴백이 `200 + index.html`을 되돌려 준다.**

⚠️ **그래서 이건 "안 되는 것"이 아니라 "틀린 초록"이다.**
- **업타임 모니터를 `https://<도메인>/health`에 걸면 backend가 죽어도 영원히
  초록으로 보인다.** 정적 파일을 서빙하는 nginx만 살아 있으면 200이 나가기 때문이다.
  DB가 끊겨도, backend 컨테이너가 통째로 내려가도 모니터는 아무 말도 하지 않는다.
- `curl -s https://<도메인>/health`의 응답이 JSON이 아니라 HTML이면 그게 이 상태다.
  `db: ok`를 찾다가 못 찾는 게 아니라, **찾을 것이 애초에 안 온다.**

**시점 구분** — 이건 지금 당장 틀린 게 아니라 날짜가 정해진 변경이다:
- **~2026-08-17**: 외부 `/health`가 아직 backend로 프록시된다(위 블록이 살아 있다).
  옛 절차대로 쳐도 답이 온다 — 다만 8/18 이후를 대비해 지금부터 아래 형태를 쓴다.
- **2026-08-18~**: 외부 `/health`는 SPA로 떨어진다. **컨테이너 안에서만** 유효하다.

**외부에서 backend 생존을 봐야 한다면** `/health`가 아니라 `/api/*` 경로를 쓴다 —
`handle /api/*`는 8/18 이후에도 backend로 그대로 프록시되므로, 거기서 오는 응답은
backend가 실제로 답한 것이다(§8.5의 `POST /api/v1/auth/guest` 201 확인이 그 예다).

브라우저에서 **로그인 없이 바로 조작되는지** 확인한다(대회 요건 — `HACKATHON_RULES.md` §4-A).
크롬 **1366×768 · 1920×1080 · 2560×1440** 세 해상도 모두 점검한다.

---

## 8. 트러블슈팅

| 증상 | 원인·조치 |
|---|---|
| `curl` 무응답, 브라우저 타임아웃 | **OS 방화벽**(§3)을 안 열었다. 클라우드 콘솔만 열어선 부족하다 |
| Caddy 인증서 발급 실패 | 도메인 A레코드가 서버 IP를 가리키는지 확인(`dig +short <도메인>`). 전파 전이면 수 분 대기. 80포트가 막혀도 실패한다(HTTP-01 챌린지) |
| `unauthorized` / `denied` (pull 시) | GHCR 로그인 누락(§4). PAT에 `read:packages` 스코프 필요 |
| `!reset` 파싱 에러 | compose v2.24 미만. §2로 재설치 |
| 컨테이너가 반복 재시작 | `$C logs <서비스>`. OOM이면 `docker stats`로 확인 후 해당 `mem_limit` 상향 |
| `exec format error` | 이미지 아키텍처 불일치. `docker image inspect <이미지> --format '{{.Architecture}}'` |
| DB 연결 거부 | `.env`의 `POSTGRES_PASSWORD`와 볼륨의 기존 비밀번호 불일치. 신규 배포면 `docker volume rm weathermind_pgdata` 후 재기동 |
| `dependency failed to start: container ... is unhealthy` — frontend·caddy가 생성되지 않음 | **의도된 게이트다**(CO-J-16). backend `/health`가 초록이 아니면 Caddy를 띄우지 않는다. `$C logs backend`로 db/redis 중 무엇이 fail인지 보고, §6·§5.1을 끝낸 뒤 `$C up -d` 재실행 |
| 재기동할 때마다 전원 로그아웃 / 게스트 진도 소실 | Redis 영속성이 꺼졌다. `$C exec redis redis-cli CONFIG GET appendonly` → `yes`여야 한다. `no`면 `infra/redis.conf` 마운트나 `command:`가 빠진 것 |
| Redis `OOM command not allowed when used memory > 'maxmemory'` | maxmemory(128mb) 도달 = 정상 운영이 아니라 폭주다. **`noeviction`이 의도적으로 쓰기를 거절한 것이고 기존 세션·큐는 살아 있다.** `redis-cli INFO memory`·`--bigkeys`로 원인을 찾고, 정말 부족하면 `infra/redis.conf`의 `maxmemory`와 prod `mem_limit`(192m)를 **함께** 올린다 |
| dev에서 컨테이너가 5회 재시작 후 죽은 채로 남음 | dev의 `on-failure:5`가 의도한 동작이다(무한 재기동이 로그를 밀어내지 않게). prod 오버레이는 `unless-stopped`라 계속 복구한다 |

## 8.5 백업과 복원 (CO-Q-5)

⚠️ **이 절이 없었다.** `db_backup.sh`·`db_restore.sh`가 8/05부터 있었고 `db-backup`
컨테이너가 매일 돌고 있었는데, **배포 문서에도 런북에도 언급이 0건**이었다. 즉 사고가
난 순간 복원 절차를 아는 사람이 코드를 읽어야 했다.

### 백업 — 자동 + 수동

`db-backup` 서비스가 `BACKUP_INTERVAL_SEC`(기본 86400 = 하루)마다 `pg_dump`(custom
format)를 `/backups` 볼륨에 남기고 최신 `BACKUP_KEEP`(기본 7)개만 유지한다. 배포
직후·시드 직후처럼 **되돌아갈 지점**이 필요하면 수동으로 한 번 찍는다:

```bash
scripts/db_backup.sh            # 호스트에서 1회 → ./backups/weathermind_<날짜>.dump
docker compose exec db-backup ls -la /backups   # 컨테이너 볼륨 쪽 확인
```

### 복원 — 두 모드, **실DB는 구조적으로 못 덮는다**

```bash
# ⓐ 리허설(기본): 임시 DB로 복원해 실DB와 테이블·행 수를 대조하고 끝나면 DROP
scripts/db_restore.sh backups/weathermind_20260809_120000.dump

# ⓑ 실복원: 새 DB로 복원한다. **전환은 운영자 몫**이다(스크립트가 실DB를 갈아끼우지 않는다)
scripts/db_restore.sh backups/weathermind_20260809_120000.dump --target weathermind_restored
```

`--target`이 실DB명과 같으면 스크립트가 즉시 실패한다 — 이 가드가 "복원하려다 덮었다"를
구조적으로 막는다.

### 🔴 복원 후 전환 절차 — 여기서 대부분 막힌다

`pg_restore --no-owner --no-privileges`는 **의도적으로** 소유자·권한을 버린다(다른
클러스터·다른 롤 이름에서도 복원이 성립해야 하므로). 그래서 복원본에는 앱 롤 GRANT도
RLS 예외 정책도 없다 — **복원은 성공했는데 런타임이 그 DB를 못 쓴다.**

`--target` 모드는 이제 스크립트가 `rls_app_role.sql`을 자동으로 재적용한다(CO-Q-4).
전환은 그 다음이다:

1. `.env`의 `DATABASE_URL`·`MIGRATION_DATABASE_URL`의 **DB명만** 복원본으로 바꾼다
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend celery-worker celery-beat`
3. `/health`가 `db: ok`인지, `POST /api/v1/auth/guest`가 201인지 확인(§7)

> **복원본에서도 마이그레이션 상태를 확인할 것** — 덤프 시점이 현재 코드보다 오래됐으면
> `alembic upgrade head`가 필요하고, 그때 §6 ①-a의 이미지 대조가 다시 적용된다.

## 9. 운영 중 갱신

```bash
git pull
IMAGE_TAG=<새 커밋 sha> $C pull && IMAGE_TAG=<새 커밋 sha> $C up -d
```

### 9.0 🔴 **시드가 바뀐 롤링이면 시드를 다시 넣어야 한다** (2026-08-14)

⚠️ **이 절이 없어서 공백이 있었다.** 시딩이 §6 「초기화(최초 1회)」에만 있고 여기
운영 중 갱신에는 없었다 — 그래서 **시드를 고친 PR이 병합돼도 실서버 DB에는 영원히
안 닿는다.** 이미지에는 새 JSON이 들어 있는데 아무도 적재를 안 부르므로, 화면은
계속 옛 문항을 낸다. 코드 결함이 아니라 **절차 공백**이라 테스트로는 안 잡힌다.

```bash
# database/seed/*.json 이 바뀐 롤링에서만. 안 바뀌었으면 건너뛴다.
$C exec backend python -m app.scripts.seed_content
```

**다시 돌려도 안전하다** — `seed_content.py`가 **멱등**이다(키 = `concept_tag` +
`question_text`). 같은 키면 기존 행을 갱신하고 새 키면 추가한다. 그래서 「고친
문항이 반영되는」 경로가 바로 이것이다.

⚠️ **다른 시드도 바뀌었으면 함께 돌린다** — 순서는 §6과 같다(`seed_courses` →
`seed_content` → `seed_units` → `seed_badges`). **`courses`가 `units`보다 먼저**라는
제약(CO-J-7)은 여기서도 그대로다.

### 🔴 9.0a 시드를 갱신해도 **이미 발급된 세션은 안 바뀐다**

문항 payload가 발급 시점에 `quiz_logs`로 **스냅샷**되어 채점이 그 사본으로 돌아간다.
그래서 시드를 고쳐도 **이미 세션을 받은 학습자는 재발급 전까지 옛 문항으로 푼다.**

- **오답 채점 결함을 고친 경우** — 시드 갱신만으로는 **오늘 이미 세션을 받은 사람에게
  안 닿는다.** 급하면 그 사실을 인지하고 별도 대응을 정할 것(세션 만료를 기다리거나
  대상 세션을 무효화하거나 — 둘 다 이 문서 밖 결정이다)
- **표기·해설만 고친 경우** — 다음 세션부터 반영되면 충분하다

**「시드를 넣었으니 반영됐다」로 검증을 끝내지 말 것.** 확인은 **새 세션을 받아서** 한다.

### 9.1 ⚠️ Redis 영속성을 처음 켜는 갱신 — **선행 1회 명령이 있다**

`infra/redis.conf`가 없던 배포(= `appendonly no`)를 이 버전으로 올릴 때, **그냥
재기동하면 기존 세션이 전부 날아간다.** 2026-08-09 redis:7.2.15 실측: RDB만 있는
데이터 디렉토리에 `appendonly yes`로 기동하면 Redis가 **빈 AOF를 새로 만들고
dump.rdb를 읽지 않는다**(로그 `Creating AOF base file ... on server start`).
세션 소실 = 게스트 진도 영구 소실이다(CO-P-4).

**먼저 라이브로 켜고 나서** 재기동한다(같은 조건에서 키 생존을 확인했다):

```bash
$C exec redis redis-cli CONFIG SET appendonly yes   # 현재 메모리 내용으로 AOF base 작성
$C up -d --force-recreate redis                     # 그 다음에야 설정 파일로 재기동
$C exec redis redis-cli CONFIG GET appendonly       # yes 확인
```

신규 볼륨(첫 배포)에는 해당 없다 — 그냥 올리면 된다.

**8/21 18:00 이후에는 소스도 env도 건드리지 않는다** — 대회 규정상 "핵심 로직
수정"으로 판정될 수 있다(`HACKATHON_RULES.md` §1.1). **URL은 시상식(9월 셋째 주)
까지 유지**해야 하므로 서버 결제·갱신 상태를 그 기간까지 확인해 둔다.
