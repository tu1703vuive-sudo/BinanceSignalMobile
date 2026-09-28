#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "== Binance Signal Mobile: iOS build =="
dotnet workload install maui
dotnet restore BinanceSignalMobile.csproj
dotnet publish BinanceSignalMobile.csproj -f net10.0-ios -c Release -p:RuntimeIdentifier=ios-arm64 -p:ArchiveOnBuild=true
find bin/Release -name '*.ipa' -print
