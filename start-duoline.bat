@echo off
setlocal
cd /d "%~dp0"
title Duoline - MyMemory
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado.
  echo Instale a versao LTS em https://nodejs.org/pt-br/download e tente novamente.
  pause
  exit /b 1
)
if not exist "public\index.html" (
  echo Nao encontrei public\index.html.
  echo Extraia todos os arquivos do ZIP e execute este arquivo na mesma pasta de server.js.
  pause
  exit /b 1
)
echo Iniciando o Duoline com a API gratuita do MyMemory...
echo Abra http://localhost:3000 no navegador.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
echo.
echo O servidor foi encerrado. Se apareceu um erro acima, confira a mensagem.
pause
