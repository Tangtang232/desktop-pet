# 测 CPU：依次以固定动作启动桌宠，预热几秒后统计一段时间内的 CPU 秒数（按主进程、GPU、页面分开）。
# 用法：powershell -File tools/bench.ps1 [-Actions walk,sit,sleep] [-Seconds 20]
# 测的时候别动鼠标：鼠标在狗附近动会让它切到 30 帧。
param([string[]]$Actions = @('walk', 'sit', 'sleep'), [int]$Seconds = 20, [int]$Warmup = 8)
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$mine = { Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root\*" } }
function Stop-Mine {
  & $mine | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($i in 1..40) { if (-not (& $mine)) { return }; Start-Sleep -Milliseconds 250 }
}
function Get-Kinds {
  $cpu = @{}
  foreach ($p in (& $mine)) {
    $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").CommandLine
    $k = if ($cl -match '--type=gpu') { 'gpu' } elseif ($cl -match '--type=renderer') { 'page' } elseif ($cl -match '--type=') { 'other' } else { 'main' }
    $cpu[$k] = $cpu[$k] + $p.CPU
  }
  $cpu
}
Stop-Mine
foreach ($a in $Actions) {
  $null = Start-Process -FilePath $exe -ArgumentList '.', "--bench=$a" -WorkingDirectory $root -PassThru
  Start-Sleep -Seconds $Warmup
  $c0 = Get-Kinds
  Start-Sleep -Seconds $Seconds
  $c1 = Get-Kinds
  $mem = ((& $mine) | Measure-Object WorkingSet64 -Sum).Sum / 1MB
  $parts = foreach ($k in 'main', 'gpu', 'page', 'other') { '{0} {1:N1}%' -f $k, (($c1[$k] - $c0[$k]) / $Seconds * 100) }
  $total = (($c1.Values | Measure-Object -Sum).Sum - ($c0.Values | Measure-Object -Sum).Sum) / $Seconds * 100
  '{0,-6} total {1,5:N1}%  ({2})  memory {3:N0} MB' -f $a, $total, ($parts -join ', '), $mem
  Stop-Mine
}
