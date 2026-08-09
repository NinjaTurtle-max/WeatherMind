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
| RAM | **최소 4GB, 권장 6GB↑** | mem_limit 합 4.12GB |
| 디스크 | 40GB↑ | 이미지 1.9GB + 데이터 |
| 공인 IP | 필수 | 없으면 외부 접속 불가 |
| 열 포트 | **22 · 80 · 443** | 클라우드 방화벽 + OS 방화벽 **양쪽** |
| 도메인 | 필수 | Caddy auto-HTTPS 전제(IP로는 인증서 발급 불가) |

**아키텍처**: GHCR 이미지는 `linux/amd64`·`linux/arm64` 둘 다 발행된다
(`release.yml`). x86 VM(GCP·AWS)도 ARM VM(Oracle A1)도 그대로 돌아간다.

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
$C up -d
```

⚠️ **첫 `up -d` 직후 backend는 정상적으로 실패 상태다** — 테이블도 정책도 아직 없다.
§6을 끝내고 §5.1 ③으로 재기동하면 뜬다.

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

## 9. 운영 중 갱신

```bash
git pull
IMAGE_TAG=<새 커밋 sha> $C pull && IMAGE_TAG=<새 커밋 sha> $C up -d
```

**8/21 18:00 이후에는 소스도 env도 건드리지 않는다** — 대회 규정상 "핵심 로직
수정"으로 판정될 수 있다(`HACKATHON_RULES.md` §1.1). **URL은 시상식(9월 셋째 주)
까지 유지**해야 하므로 서버 결제·갱신 상태를 그 기간까지 확인해 둔다.
