# 测 CPU：依次以固定动作启动桌宠，预热几秒后统计一段时间内的 CPU 秒数（按主进程、GPU、页面分开）。
# 用法：powershell -File tools/bench.ps1 [-Actions walk,sit,sleep] [-Seconds 20]
# 测的时候别动鼠标：鼠标在狗附近动会让它切到 30 帧。
# 只统计这个脚本自己启动的那一份程序。桌面上正在养的那只：测之前正常关掉（免得桌上出现两只、读数受干扰），测完原样重新打开。
param([string[]]$Actions = @('walk', 'sit', 'sleep'), [int]$Seconds = 20, [int]$Warmup = 8)
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
# 一次 -Actions walk,sit 从命令行传进来是一个字符串，这里拆开
$Actions = @($Actions | ForEach-Object { $_ -split ',' } | Where-Object { $_ })

# 这一份程序的进程：主进程加上它直接启动的子进程（GPU、页面、工具进程）
function Get-Tree([int]$mainId) {
  @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ProcessId -eq $mainId -or $_.ParentProcessId -eq $mainId })
}
function Get-Kinds([int]$mainId) {
  $cpu = @{}
  foreach ($w in (Get-Tree $mainId)) {
    $p = Get-Process -Id $w.ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $k = if ($w.CommandLine -match '--type=gpu') { 'gpu' } elseif ($w.CommandLine -match '--type=renderer') { 'page' } elseif ($w.CommandLine -match '--type=') { 'other' } else { 'main' }
    $cpu[$k] = $cpu[$k] + $p.CPU
  }
  $cpu
}
# 先礼貌地关（让程序自己退出、收好托盘图标），几秒没退再强制
function Stop-Tree([int]$mainId) {
  $null = & taskkill.exe /PID $mainId 2>$null
  foreach ($i in 1..20) { if (-not (Get-Process -Id $mainId -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }
  foreach ($w in (Get-Tree $mainId)) { Stop-Process -Id $w.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

# 桌面上正在养的那只（不是测试用的那份）：先正常关掉，测完用同样的参数重新打开
$pets = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch '--bench=|--smoke' -and $_.ExecutablePath -like "$root\*" })
$restart = @()
foreach ($pp in $pets) {
  $args0 = ($pp.CommandLine -replace '^\s*("[^"]*"|\S+)\s*', '')
  $restart += , $(if ($args0) { $args0 } else { '.' })
  Stop-Tree $pp.ProcessId
}
if ($pets.Count) { '（先把桌面上那只正常关掉了，测完会重新打开）' }

foreach ($a in $Actions) {
  $p = Start-Process -FilePath $exe -ArgumentList '.', "--bench=$a" -WorkingDirectory $root -PassThru
  Start-Sleep -Seconds $Warmup
  $c0 = Get-Kinds $p.Id
  Start-Sleep -Seconds $Seconds
  $c1 = Get-Kinds $p.Id
  $mem = ((Get-Tree $p.Id | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }) | Measure-Object WorkingSet64 -Sum).Sum / 1MB
  $parts = foreach ($k in 'main', 'gpu', 'page', 'other') { '{0} {1:N1}%' -f $k, (($c1[$k] - $c0[$k]) / $Seconds * 100) }
  $total = (($c1.Values | Measure-Object -Sum).Sum - ($c0.Values | Measure-Object -Sum).Sum) / $Seconds * 100
  '{0,-6} total {1,5:N1}%  ({2})  memory {3:N0} MB' -f $a, $total, ($parts -join ', '), $mem
  Stop-Tree $p.Id
}
foreach ($a0 in $restart) { $null = Start-Process -FilePath $exe -ArgumentList $a0 -WorkingDirectory $root; '（桌面上那只重新打开了）' }
