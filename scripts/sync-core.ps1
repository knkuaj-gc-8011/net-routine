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
