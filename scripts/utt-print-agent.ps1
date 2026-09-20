$ErrorActionPreference = 'Stop'
$BaseUrl = 'https://unitedtraffictickets.com'
$TokenPath = Join-Path $env:LOCALAPPDATA 'UnitedTrafficTickets\print-agent-token.txt'
$Token = if (Test-Path $TokenPath) { (Get-Content $TokenPath -Raw).Trim() } else { '' }
if ([string]::IsNullOrWhiteSpace($Token)) { throw 'Print agent token is not configured.' }
$TempDir = Join-Path $env:LOCALAPPDATA 'UnitedTrafficTickets\PrintQueue'
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$headers = @{ 'X-Print-Agent-Token' = $Token }
while ($true) {
  try {
    $response = Invoke-WebRequest -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Get -TimeoutSec 30 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
      $jobId = $response.Headers['X-Print-Job-Id']
      $filename = $response.Headers['X-Print-Filename']
      if ([string]::IsNullOrWhiteSpace($jobId)) { throw 'Print queue response did not include a job id.' }
      if ([string]::IsNullOrWhiteSpace($filename)) { $filename = 'TR-205.pdf' }
      $safe = ($filename -replace '[^A-Za-z0-9._ -]','_')
      $pdf = Join-Path $TempDir ($jobId + '_' + $safe)
      [IO.File]::WriteAllBytes($pdf, $response.Content)
      try {
        Start-Process -FilePath $pdf -Verb Print -Wait
        Invoke-RestMethod -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{ id=$jobId; status='printed' } | ConvertTo-Json) | Out-Null
        Remove-Item $pdf -Force -ErrorAction SilentlyContinue
      } catch {
        $msg = $_.Exception.Message
        try { Invoke-RestMethod -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{ id=$jobId; status='failed'; error=$msg } | ConvertTo-Json) | Out-Null } catch {}
      }
    }
  } catch {}
  Start-Sleep -Seconds 5
}
