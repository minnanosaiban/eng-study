@echo off
setlocal

rem ============================================================
rem  eng-study deploy (Cloudflare Workers + static assets)
rem  Double-click after changes to update the live site.
rem
rem  First-time setup (run once in this folder):
rem    npx wrangler login
rem ============================================================

echo === Deploy eng-study to Cloudflare Workers ===
cd /d "%~dp0"
echo Current: %CD%

echo === Cloudflare deploy ===
call npx wrangler deploy
if %errorlevel% neq 0 (
    echo [ERROR] Deploy failed.
    pause
    exit /b 1
)

echo === Commit ^& Push to GitHub (main) ===
git add .
git commit -m "Update eng-study" || echo No changes to commit
git push -u origin main
if %errorlevel% neq 0 (
    echo [WARN] Git push failed. The Cloudflare deploy itself succeeded.
)

echo === Done ===
pause
