$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
python -m uvicorn backend.main:app --reload --port 5000
