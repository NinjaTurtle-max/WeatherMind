@echo off
rem ============================================================================
rem  WeatherMind - Windows 개발 실행기 (Docker 백엔드 + Vite 프론트)
rem
rem  쓰는 법:  저장소 폴더에서  dev.cmd   (또는 파일을 더블클릭)
rem
rem  ⚠️ **목(mock)이 아니라 실제 백엔드로 띄운다**(2026-08-18 사용자 지시
rem     "항상 도커로 띄워서 보게 해줘"). `VITE_MOCK=1`은 백엔드 없이 화면만
rem     보는 모드인데, 목에는 코스가 0개(`GET /courses` 없음) · 유닛이 10개뿐이라
rem     코스 탭이 안 뜨고 학습 경로가 3칸으로 보인다. 그것이 화면 결함으로
rem     오인돼 이 파일을 만들게 됐다. 아래 5단계가 그 오인을 원천에서 없앤다.
rem
rem  ⚠️ 프론트는 **컨테이너가 아니라 호스트의 vite dev server**로 띄운다.
rem     compose의 `frontend` 서비스는 빌드된 정적 SPA(80포트)라 코드를 고쳐도
rem     다시 빌드하기 전에는 화면이 안 바뀐다 — 디자인 작업에는 못 쓴다.
rem     vite는 `/api/v1`을 localhost:8000으로 프록시한다(frontend/vite.config.js).
rem ============================================================================
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

rem compose v2(플러그인) 우선, 없으면 v1 실행파일로 떨어진다.
docker compose version >nul 2>&1 && (set "DC=docker compose") || (set "DC=docker-compose")

rem .env가 없으면 backend 컨테이너가 env_file에서 죽는다. 예시본을 깔아 준다.
rem ⚠️ .env는 .gitignore에 있다(대회 규정: API 키 노출 = 실격). 절대 커밋 금지.
if not exist ".env" (
  echo [0/5] .env 가 없어 .env.example 을 복사합니다.
  copy /y ".env.example" ".env" >nul
)

echo.
echo [1/5] Docker 백엔드 스택 기동 ^(postgres · redis · backend^)...
%DC% up -d postgres redis backend
if errorlevel 1 goto :dockerfail

echo.
echo [2/5] 백엔드가 응답할 때까지 대기...
set /a _tries=0
:wait
curl -s -o nul http://localhost:8000/health && goto :ready
set /a _tries+=1
if %_tries% GEQ 90 goto :healthfail
timeout /t 2 /nobreak >nul
goto :wait
:ready
echo       OK - http://localhost:8000/health

echo.
echo [3/5] DB 마이그레이션 ^(멱등 - 이미 최신이면 아무것도 안 한다^)...
%DC% exec -T backend alembic upgrade head
if errorlevel 1 goto :migratefail

echo.
echo [4/5] 문항 시드 ^(멱등 - 키는 concept_tag + question_text^)...
rem 매번 돌린다. 마커 파일로 건너뛰면 `docker compose down -v`로 볼륨을 지운
rem 날에 빈 DB인 채로 "이미 했다"고 넘어가 화면이 텅 빈다 — 몇 초 더 걸리는
rem 쪽이 그 함정보다 낫다.
%DC% exec -T backend python -m app.scripts.seed_content

echo.
echo [5/5] 프론트 개발 서버...
cd frontend
if not exist "node_modules" (
  echo       node_modules 가 없어 npm install 을 먼저 합니다 ^(몇 분 걸립니다^)...
  call npm install
  if errorlevel 1 goto :npmfail
)
rem ⚠️ **반드시 비운다.** 같은 창에서 앞서 `set "VITE_MOCK=1"`을 쳤다면 그 값이
rem    남아 있어, 도커를 띄워 놓고도 목 화면을 보게 된다.
set "VITE_MOCK="
echo.
echo  ─────────────────────────────────────────────────────────────
echo   준비 끝. 브라우저에서  http://localhost:5173  을 여세요.
echo   ^(5173이 이미 쓰이고 있으면 vite가 5174 등으로 올려 띄웁니다 —
echo    아래 Local 주소를 그대로 보세요.^)
echo   끄려면 이 창에서 Ctrl+C. 백엔드까지 끄려면:  dev-stop.cmd
echo  ─────────────────────────────────────────────────────────────
echo.
call npm run dev
goto :end

:dockerfail
echo.
echo  [!] Docker 를 띄우지 못했습니다.
echo      Docker Desktop 이 실행 중인지 확인하고 다시 시도하세요.
echo      ^(작업표시줄 고래 아이콘이 "Running" 이어야 합니다^)
goto :end

:healthfail
echo.
echo  [!] 백엔드가 3분 안에 응답하지 않았습니다.
echo      로그를 보세요:   %DC% logs --tail=50 backend
echo.
echo      로그에 role "weathermind_app" 이 없다고 나오면, RLS 롤을 만들기 전에
echo      만들어진 옛 DB 볼륨입니다. 이걸 한 번 돌리면 됩니다^(멱등^):
echo        %DC% exec -T postgres psql -U weathermind -d weathermind -f /dev/stdin ^< backend\app\scripts\rls_app_role.sql
goto :end

:migratefail
echo.
echo  [!] 마이그레이션이 실패했습니다.
echo      로그를 보세요:   %DC% logs --tail=50 backend
goto :end

:npmfail
echo.
echo  [!] npm install 이 실패했습니다. node -v 로 Node 설치를 확인하세요.
goto :end

:end
endlocal
