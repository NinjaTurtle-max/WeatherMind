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

**아키텍처**: GHCR 이미지는 `linux/amd64`·`linux/arm64` 둘 다 발행된다
(`release.yml`). x86 VM(GCP·AWS)도 ARM VM(Oracle A1)도 그대로 돌아간다.

**재기동 정책**: prod 전 컨테이너가 `restart: unless-stopped`다 — **호스트 재부팅
후에도 스택이 자동 복구된다**(URL을 9월 셋째 주까지 유지해야 하므로 이게 계약이다).
운영자가 `docker compose stop`으로 명시적으로 내린 것만 그대로 남는다.

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
| `KMA_API_KEY` | **팀 자체 발급 키**(대회 제공 키는 8/22 만료 — `HACKATHON_RULES.md` §3) |
| `GEMINI_API_KEY` | 키 게이트에서 투입. **없어도 폴백으로 전 기능 동작**. 임베딩 키는 없다(R13 3일차 철거) |
| `IMAGE_TAG` | 배포할 커밋 sha 권장(미설정 시 `latest`) |

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

## 6. 초기화 (최초 1회)

⚠️ **순서가 계약이다.** 어기면 조용히 깨진다 — 아래 각 단계에 이유를 적었다.

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# ① 마이그레이션 — 소유자 롤(MIGRATION_DATABASE_URL)로 돈다
$C exec backend alembic upgrade head

# ② RLS 예외 정책 — **신규 볼륨에도 필수다** (CO-Q-12)
#    init.sql은 롤·GRANT만 만든다. 그 시점엔 테이블이 없어 정책을 만들 수 없다.
#    이걸 건너뛰면 users에 user_isolation만 걸려 **로그인·게스트 시작이 전면 0행**이고,
#    리더보드도 빈다. "기존 볼륨에만"이 아니다.
$C exec -T postgres psql -U weathermind -d weathermind \
  < backend/app/scripts/rls_app_role.sql

# ③ 시드 — **courses가 units보다 먼저** (CO-J-7)
#    seed_units가 course 슬러그를 못 찾으면 course_id를 NULL로 두고 넘어간다.
#    그러면 전 유닛이 단일 코스로 뭉치고 GET /courses가 비어 학습 화면이 백지가 된다.
#    scripts/smoke.sh가 이 순서를 계약으로 검사한다.
$C exec backend python -m app.scripts.seed_courses    # ← 빠뜨리기 쉽다
$C exec backend python -m app.scripts.seed_content    # 문항 272
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
curl -I https://<도메인>/        # 200
curl -s https://<도메인>/health  # backend 헬스 — Caddy가 /health를 직접 프록시한다
                                 # (infra/Caddyfile: /api/* 와 /health만 backend 행)
docker stats --no-stream       # 메모리가 mem_limit 안에 있는지
```

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

## 9. 운영 중 갱신

```bash
git pull
IMAGE_TAG=<새 커밋 sha> $C pull && IMAGE_TAG=<새 커밋 sha> $C up -d
```

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
