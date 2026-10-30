@echo off
rem Opens the Auto Mix window: the flrender venv's Python if it's there, else whatever pythonw is on the PATH.
set "PY=%~dp0..\.venv\Scripts\pythonw.exe"
if not exist "%PY%" set "PY=pythonw"
start "" "%PY%" "%~dp0app.py"
