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
| `MIGRATION_DATABASE_URL` | 소유자 롤 — RLS 전제(`docs/specs/08`) |
| `KMA_API_KEY` | **팀 자체 발급 키**(대회 제공 키는 8/22 만료 — `HACKATHON_RULES.md` §3) |
| `GEMINI_API_KEY`·`EMBEDDING_API_KEY` | 키 게이트에서 투입. **없어도 폴백으로 전 기능 동작** |
| `IMAGE_TAG` | 배포할 커밋 sha 권장(미설정 시 `latest`) |

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 6. 초기화 (최초 1회)

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

$C exec backend alembic upgrade head          # 마이그레이션
$C exec backend python -m app.scripts.seed_content    # 문항
$C exec backend python -m app.scripts.seed_units      # 유닛 트리
$C exec backend python -m app.scripts.seed_badges     # 배지
$C exec ai-worker python -m app.embeddings.seed_concepts  # 벡터 시드(임베딩 키 필요)

# 기존 볼륨에 RLS 앱 롤이 없다면 (신규 볼륨은 init.sql이 처리)
$C exec -T postgres psql -U weathermind -d weathermind \
  < backend/app/scripts/rls_app_role.sql
```

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
