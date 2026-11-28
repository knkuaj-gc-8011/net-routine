# shared/ の正本（core.js, editor.js, editor.css）を extension/ と iphone/ へコピーする
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\sync-core.ps1
$root = Split-Path -Parent $PSScriptRoot
$files = @('core.js', 'editor.js', 'editor.css')
foreach ($dir in @('extension', 'iphone')) {
    foreach ($f in $files) {
        Copy-Item -Path (Join-Path $root "shared\$f") -Destination (Join-Path $root "$dir\$f") -Force
    }
    Write-Host "コピーしました: $dir\ ($($files -join ', '))"
}
# iPhone アプリ（Expo 版）は画面の作りが違うので、ロジックの core.js だけ使う
Copy-Item -Path (Join-Path $root "shared\core.js") -Destination (Join-Path $root "mobile\src\core.js") -Force
Write-Host "コピーしました: mobile\src\ (core.js)"
