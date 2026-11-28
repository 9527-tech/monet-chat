@echo off
set PORT=4175
set AUTO_TUNNEL=1
cd /d D:\OneDrive\Documents\deepseek-harness\default-workspace\monet-chat
if not exist logs mkdir logs
D:\node.exe server.mjs >> logs\permanent-server.log 2>&1
