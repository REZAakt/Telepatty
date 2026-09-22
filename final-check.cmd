@echo off
cd /d d:\Computer\Vue\Telepatty
echo [final-check] killing stale dev servers on 3000-3103...
powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort 3000,3001,3100,3102,3103,8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {} }"
timeout /t 5 /nobreak >nul
echo [final-check] clearing .nuxt + .output + node .vite cache (force a from-scratch i18n setup)...
rmdir /s /q .nuxt 2>nul
rmdir /s /q .output 2>nul
rmdir /s /q node_modules\.vite 2>nul
del onboarding-probe.txt dev-final.log 2>nul
echo [final-check] starting FRESH nuxt dev @3100 (detached)...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','pnpm dev --port 3100 > dev-final.log 2>&1' -WindowStyle Hidden"
echo [final-check] waiting 65s for fresh boot + i18n plugin generation...
timeout /t 65 /nobreak >nul
echo === ONBOARDING PROBE ===> onboarding-probe.txt
node final-probe.cjs http://localhost:3100/onboarding 22000 >> onboarding-probe.txt 2>&1
echo === HOME (no identity yet) PROBE ===>> onboarding-probe.txt
node final-probe.cjs http://localhost:3100/ 15000 >> onboarding-probe.txt 2>&1
echo === DEV-LOG TAIL ===>> onboarding-probe.txt
powershell -NoProfile -Command "Get-Content dev-final.log -Tail 14" >> onboarding-probe.txt 2>&1
echo [final-check] DONE >> onboarding-probe.txt
