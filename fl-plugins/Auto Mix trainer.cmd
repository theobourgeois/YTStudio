@echo off
rem The Auto Mix trainer: mix your songs by ear for Auto Mix to learn from (README: Teaching it your taste).
set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
cd /d "%~dp0train"
"%PY%" trainer.py --open
