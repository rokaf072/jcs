# 정치쇼 출연자 보드(PC) 업데이트 도우미
# 평소에는 아무것도 안 하고 쉬다가, 앱의 [⚙ 관리 → ⬆ 업데이트] 단추를 눌렀을 때만 크롬이 잠깐 불러서 씀
#   -Setup      : 처음 한 번. 크롬에 '업데이트 도우미'로 등록 (관리자 권한 필요 없음)
#   -NativeHost : 크롬이 부를 때 (사람이 직접 쓰지 않음)
#   -Show       : 직접 실행해서 지금 바로 업데이트
param([switch]$Setup, [switch]$NativeHost, [switch]$Show)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$dir  = $PSScriptRoot
$base = if ($env:JCS_BASE) { $env:JCS_BASE } else { 'https://rokaf072.github.io/jcs/pc/' }
$hostName = 'com.jcs.guest_update'
$extId = 'haajcigfhmjkfmpfpaghklklgbimcabc'
$log  = Join-Path $dir 'update.log'
function Log($m) {
  try {
    $old = @(); if (Test-Path -LiteralPath $log) { $old = @(Get-Content -LiteralPath $log -Encoding UTF8 | Select-Object -Last 100) }
    Set-Content -LiteralPath $log -Value ($old + ((Get-Date -Format 'yyyy-MM-dd HH:mm') + '  ' + $m)) -Encoding UTF8
  } catch {}
}

# 새 파일 받아서 이 폴더에 넣기 → { version, count }
function Update-App {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('jcs-up-' + [guid]::NewGuid().ToString('N'))
  try {
    $t = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $r = Invoke-WebRequest -UseBasicParsing -Uri ($base + 'files.json?t=' + $t) -TimeoutSec 30
    $list = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
    $todo = @()
    foreach ($f in $list.files) {
      if ($f.p -eq 'config.js') { continue }                       # 카카오 키가 든 설정 파일은 각 PC 것을 그대로
      $local = Join-Path $dir $f.p
      if ((Test-Path -LiteralPath $local) -and ((Get-FileHash -LiteralPath $local -Algorithm SHA1).Hash -ieq $f.h)) { continue }
      $todo += $f
    }
    foreach ($f in $todo) {   # 1) 임시 폴더로 모두 받고 내용 확인 (GitHub가 아직 반영 중이면 중단)
      $dst = Join-Path $tmp $f.p
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      $u = $base + ((($f.p -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/') + '?t=' + $t
      Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $dst -TimeoutSec 180 | Out-Null
      if ((Get-FileHash -LiteralPath $dst -Algorithm SHA1).Hash -ine $f.h) { throw ('GitHub에 아직 반영 중이에요. 1~2분 뒤 다시 눌러 주세요. (' + $f.p + ')') }
    }
    foreach ($f in ($todo | Sort-Object { if ($_.p -eq 'manifest.json') { 1 } else { 0 } })) {   # 2) 덮어쓰기 (manifest.json 마지막)
      $dst = Join-Path $dir $f.p
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -LiteralPath (Join-Path $tmp $f.p) -Destination $dst -Force
    }
    foreach ($p in @($list.remove)) { if ($p) { Remove-Item -LiteralPath (Join-Path $dir $p) -Force -ErrorAction SilentlyContinue } }   # 더 안 쓰는 파일 정리
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'config.js'))) {
      Set-Content -LiteralPath (Join-Path $dir 'config.js') -Value "const KAKAO_REST_KEY = '';" -Encoding UTF8
    }
    Log ('업데이트 ' + $list.version + ' (' + $todo.Count + '개 파일)')
    return @{ ok = $true; version = $list.version; n = $todo.Count }
  } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($NativeHost) {
  # 크롬과 주고받기: 앞 4바이트 = 길이, 뒤 = JSON
  $in = [Console]::OpenStandardInput(); $out = [Console]::OpenStandardOutput()
  function Reply($obj) { $b = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress)); $out.Write([BitConverter]::GetBytes([int]$b.Length), 0, 4); $out.Write($b, 0, $b.Length); $out.Flush() }
  try {
    $lb = New-Object byte[] 4; $n = 0; while ($n -lt 4) { $k = $in.Read($lb, $n, 4 - $n); if ($k -le 0) { exit 0 }; $n += $k }
    $len = [BitConverter]::ToInt32($lb, 0); $buf = New-Object byte[] $len; $n = 0
    while ($n -lt $len) { $k = $in.Read($buf, $n, $len - $n); if ($k -le 0) { break }; $n += $k }
    $msg = [Text.Encoding]::UTF8.GetString($buf, 0, $n) | ConvertFrom-Json
    if ($msg.cmd -eq 'ping') { Reply @{ ok = $true; ping = $true } }
    elseif ($msg.cmd -eq 'update') { Reply (Update-App) }
    else { Reply @{ ok = $false; error = '알 수 없는 요청' } }
  } catch { Log ('업데이트 실패: ' + $_.Exception.Message); Reply @{ ok = $false; error = $_.Exception.Message } }
  exit 0
}

if ($Setup) {
  Write-Host ''
  # 예전 '15분마다 확인' 예약이 있으면 지움 (이제 단추를 누를 때만 업데이트)
  schtasks /Delete /F /TN 'JCS-Guest-Board-Update' 2>&1 | Out-Null
  $bat = Join-Path $dir 'jcs-host.bat'
  $json = Join-Path $dir 'jcs-host.json'
  $m = [ordered]@{ name = $hostName; description = '정치쇼 출연자 업데이트 도우미'; path = $bat; type = 'stdio'; allowed_origins = @("chrome-extension://$extId/") }
  [IO.File]::WriteAllText($json, ($m | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  $ok = $true
  foreach ($b in @('Google\Chrome', 'Microsoft\Edge')) {
    $out = reg add ("HKCU\Software\$b\NativeMessagingHosts\$hostName") /ve /t REG_SZ /d $json /f 2>&1
    if ($LASTEXITCODE -ne 0 -and $b -eq 'Google\Chrome') { $ok = $false; Write-Host ('  ' + ($out -join ' ')) }
  }
  if ($ok) {
    Write-Host '  ✔ 업데이트 기능을 켰어요.' -ForegroundColor Green
    Write-Host '    이제 앱의 [⚙ 관리] → [최신 버전 확인] → [⬆ 업데이트]로 업데이트할 수 있어요.'
    Write-Host '    평소엔 아무것도 실행되지 않아요. 단추를 누를 때만 잠깐 동작해요.'
  } else { Write-Host '  업데이트 기능을 켜지 못했어요. (회사 보안 설정 때문일 수 있어요)' -ForegroundColor Red }
  exit 0
}

if ($Show) {
  Write-Host ''
  try {
    $r = Update-App
    if ($r.n) { Write-Host ('  ✔ 새 버전 ' + $r.version + '(으)로 바꿨어요. 열려 있는 창은 10초 안에 새 버전으로 다시 열려요.') -ForegroundColor Green }
    else { Write-Host ('  이미 최신 버전이에요. (' + $r.version + ')') -ForegroundColor Green }
  } catch { Write-Host ('  업데이트하지 못했어요: ' + $_.Exception.Message) -ForegroundColor Yellow }
}
