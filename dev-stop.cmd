@echo off
rem ============================================================================
rem  WeatherMind - 개발 스택 정지 (dev.cmd 짝)
rem
rem  ⚠️ `down`이지 `down -v`가 **아니다.** -v는 DB 볼륨까지 지워서 다음에 켤 때
rem     마이그레이션·시드를 처음부터 다시 하고, 그동안 쌓인 진도·리그 기록이
rem     전부 사라진다. 정말 초기화하고 싶을 때만 아래 마지막 줄의 안내를 따를 것.
rem ============================================================================
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

docker compose version >nul 2>&1 && (set "DC=docker compose") || (set "DC=docker-compose")

echo 백엔드 스택을 내립니다 ^(데이터는 남습니다^)...
%DC% down

echo.
echo  완료. 다시 켜려면  dev.cmd
echo  ^(DB까지 완전히 초기화하려면:  %DC% down -v  — 진도·기록이 사라집니다^)
endlocal
