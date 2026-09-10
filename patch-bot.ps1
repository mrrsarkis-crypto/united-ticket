$ErrorActionPreference = "Stop"
$pub = "C:\Users\arpin\united-ticket\public"
$idxPath = Join-Path $pub "index.html"
$idx = [IO.File]::ReadAllText($idxPath)
Write-Host "index length $($idx.Length)"
if ($idx -notmatch 'href="/bot-courthouse"') {
  $markers = @(
    'SCAN MY TICKET — FREE</a>',
    'SCAN MY TICKET - FREE</a>',
    'SCAN MY TICKET</a>',
    'Free Ticket Scan</a>',
    'href="/assistant">Scan My Ticket</a>'
  )
  $done = $false
  foreach ($m in $markers) {
    $i = $idx.IndexOf($m)
    if ($i -ge 0) {
      $insertAt = $i + $m.Length
      $cta = "`r`n          <a class=`"btn btn-amber`" href=`"/bot-courthouse`">OPEN BOT COURTHOUSE</a>"
      $idx = $idx.Insert($insertAt, $cta)
      [IO.File]::WriteAllText($idxPath, $idx)
      Write-Host "index hero CTA added after: $m"
      $done = $true
      break
    }
  }
  if (-not $done) {
    # dump nearby hero-actions for debug
    $h = $idx.IndexOf('hero-actions')
    if ($h -ge 0) { Write-Host $idx.Substring($h, [Math]::Min(500, $idx.Length-$h)) }
    else { Write-Host "no hero-actions found" }
  }
} else {
  Write-Host "index already has bot-courthouse"
}

$files = Get-ChildItem -Path $pub -Recurse -Filter "*.html"
foreach ($f in $files) {
  $c = [IO.File]::ReadAllText($f.FullName)
  $orig = $c
  if ($c -match 'Courthouses' -and $c -notmatch 'href="/bot-courthouse">Bot Courthouse') {
    $old = '<li><a href="/all-courthouses">All 58 CA Counties</a></li>'
    $new = '<li><a href="/bot-courthouse">Bot Courthouse</a></li>' + "`r`n            <li><a href=`"/all-courthouses`">All 58 CA Counties</a></li>"
    if ($c.Contains($old)) { $c = $c.Replace($old, $new) }
  }
  if ($c -ne $orig) {
    [IO.File]::WriteAllText($f.FullName, $c)
    Write-Host "patched $($f.Name)"
  }
}

Write-Host "==== verify ===="
@(
  "bot-courthouse.html",
  "bot-courthouse.js",
  "bot-courthouse.css",
  "data\ca-counties.json"
) | ForEach-Object { "$_ : $(Test-Path (Join-Path $pub $_))" }
$n = ([IO.File]::ReadAllText((Join-Path $pub "data\ca-counties.json")) | ConvertFrom-Json).Count
Write-Host "counties: $n"
Select-String -Path $idxPath -Pattern "bot-courthouse" | Select-Object -First 8 | ForEach-Object { $_.Line.Trim().Substring(0, [Math]::Min(120, $_.Line.Trim().Length)) }
