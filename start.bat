@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Amirai - генератор подборок аниме ===
echo Устанавливаю зависимости (один раз)...
python -m pip install -q -r requirements.txt
echo Запускаю сервер на http://127.0.0.1:5000
start "" http://127.0.0.1:5000
python app.py
pause
